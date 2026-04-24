export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    // Handle /setup GET request to register Discord commands
    if (request.method === 'GET' && url.pathname === '/setup') {
      return await setupDiscordCommands(env);
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const discordSignature = request.headers.get('x-signature-ed25519');

      if (discordSignature || url.pathname === '/discord') {
        return await handleDiscordRequest(request, env);
      }

      const payload = await request.json();
      if (payload.channel_post) {
        await handleTelegramChannelPost(payload.channel_post, env);
      } else if (payload.message) {
        await handleTelegramMessage(payload.message, env);
      }
    } catch (e) {
      console.error(e);
    }

    return new Response('OK');
  }
};

async function handleTelegramMessage(message, env) {
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const text = message.text?.trim();

  // Handle new chat members
  if (message.new_chat_members && message.new_chat_members.length > 0) {
    const welcomeText = 
      "<b>欢迎加入！👋</b>\n\n" +
      "请查看置顶消息获取订阅和其他信息";
    
    await sendTelegramMessage(chatId, welcomeText, env);
    return;
  }

  if (!text) return;

  if (text === '/start') {
    const welcomeText = 
      "<b>你好！尊贵的客人</b> 👋\n\n" +
      "为了维护群组环境，请按照以下步骤操作：\n\n" +
      "1️⃣ 发送你的学生edu教育邮箱地址\n\n" +
      "2️⃣ 检查邮箱并获取 6 位验证码\n\n" +
      "3️⃣ 直接在此回复验证码\n\n" +
      "验证通过后，我将为你生成一次性的群组邀请链接。";
    
    await sendTelegramMessage(chatId, welcomeText, env);
    return;
  }

  if (chatType !== 'private') {
    return;
  }

  if (text.includes('@')) {
    const email = text.toLowerCase();
    const allowedList = env.ALLOWED_DOMAINS.split(',').map(d => d.trim().toLowerCase());
    const hasValidDomain = allowedList.some(domain => email.endsWith(domain));

    if (hasValidDomain) {
      const code = Math.floor(100000 + Math.random() * 900000).toString();
      
      await env.AUTH_KV.put(`code_${chatId}`, code, { expirationTtl: 300 });
      
      const emailSent = await sendResendEmail(email, code, env);
      
      if (emailSent) {
        await sendTelegramMessage(chatId, "✅ 验证码已发送！\n\n请回复 6 位验证码，有效期 5 分钟", env);
      } else {
        await sendTelegramMessage(chatId, "❌ 邮件发送失败，请联系管理员或稍后再试", env);
      }
    } else {
      await sendTelegramMessage(chatId, `🚫 还不支持该邮箱后缀喵~\n\n请发送至 loosen@ich.cc.cd 添加，目前仅支持申请 @*.edu.cn 邮箱后缀`, env);
    }
  } 
  
  else if (/^\d{6}$/.test(text)) {
    const savedCode = await env.AUTH_KV.get(`code_${chatId}`);
  
    if (text === savedCode) {
      const groupInviteLink = await createInviteLink(env.GROUP_ID, env);
      const channelInviteLink = await createInviteLink(env.CHANNEL_ID, env);
      
      if (groupInviteLink && channelInviteLink) {
        await sendTelegramMessage(chatId, `🎉 验证成功！\n\n点击下方链接加入群组（一次性链接，1小时内有效）：\n${groupInviteLink}\n\n点击下方链接加入频道（一次性链接，1小时内有效）：\n${channelInviteLink}`, env);
        await env.AUTH_KV.delete(`code_${chatId}`);
      } else {
        await sendTelegramMessage(chatId, "❌ 无法生成邀请链接， Bot 是否具有管理员权限？", env);
      }
    } else {
      await sendTelegramMessage(chatId, "⚠️ 验证码错误或已过期，请重新输入或发送邮箱获取新验证码", env);
    }
  }
}

async function handleTelegramChannelPost(message, env) {
  const sourceChannelId = env.TELEGRAM_SOURCE_CHANNEL_ID?.trim();
  const targetDiscordChannelId = env.DISCORD_FORWARD_CHANNEL_ID?.trim();

  if (!targetDiscordChannelId) {
    console.warn('DISCORD_FORWARD_CHANNEL_ID is not configured');
    return;
  }

  if (sourceChannelId && String(message.chat?.id) !== sourceChannelId) {
    return;
  }

  const channelTitle = message.chat?.title || 'Telegram频道';
  const content = getTelegramChannelPostContent(message);
  const sourceLink = getTelegramChannelPostLink(message);

  if (!content) {
    return;
  }

  const discordMessage =
    `来自 ${channelTitle} 的新消息\n` +
    `\n${content}` +
    (sourceLink ? `\n\n原帖：${sourceLink}` : '');

  await sendDiscordChannelMessage(targetDiscordChannelId, discordMessage, env);
}

function getTelegramChannelPostContent(message) {
  const text = message.text?.trim() || message.caption?.trim();

  if (text) {
    return text;
  }

  const mediaLabel =
    message.photo ? '图片' :
    message.video ? '视频' :
    message.document ? '文件' :
    message.audio ? '音频' :
    message.voice ? '语音' :
    message.animation ? '动图' :
    message.sticker ? '贴纸' :
    '消息';

  return `发布了一条${mediaLabel}，但没有可转发的文字内容。`;
}

function getTelegramChannelPostLink(message) {
  const username = message.chat?.username;
  const messageId = message.message_id;

  if (!username || !messageId) {
    return null;
  }

  return `https://t.me/${username}/${messageId}`;
}

async function handleDiscordRequest(request, env) {
  const body = await request.text();

  if (env.DISCORD_PUBLIC_KEY) {
    const signature = request.headers.get('x-signature-ed25519');
    const timestamp = request.headers.get('x-signature-timestamp');
    const valid = await verifyDiscordSignature(signature, timestamp, body, env.DISCORD_PUBLIC_KEY);

    if (!valid) {
      return new Response('invalid request signature', { status: 401 });
    }
  }

  let interaction;
  try {
    interaction = JSON.parse(body);
  } catch (e) {
    console.error('Discord payload parse failed', e);
    return new Response('bad request', { status: 400 });
  }

  if (interaction.type === 1) {
    return jsonResponse({ type: 1 });
  }

  if (interaction.type === 5) {
    return await handleDiscordModalSubmit(interaction, env);
  }

  if (interaction.type !== 2) {
    return jsonResponse({
      type: 4,
      data: {
        content: '目前仅支持斜杠命令验证。',
        flags: 64
      }
    });
  }

  const commandName = interaction.data?.name;
  const options = interaction.data?.options || [];
  const userId = interaction.member?.user?.id || interaction.user?.id;

  if (!userId) {
    return jsonResponse({
      type: 4,
      data: {
        content: '无法识别用户身份，请稍后再试。',
        flags: 64
      }
    });
  }

  if (commandName === 'start') {
    return jsonResponse({
      type: 4,
      data: {
        content:
          '你好！尊贵的客人 👋\n\n' +
          '为了维护社区环境，请按以下步骤操作：\n' +
          '1. 使用 /verify 打开私密验证窗口，或直接使用 /email 提交 edu 邮箱\n' +
          '2. 检查邮箱获取 6 位验证码\n' +
          '3. 使用 /code 命令提交验证码\n\n' +
          '验证通过后，我会为你自动添加“已验证”身份组。',
        flags: 64
      }
    });
  }

  if (commandName === 'verify') {
    return jsonResponse(createDiscordVerifyModal());
  }

  if (commandName === 'email') {
    const email = getDiscordOptionValue(options, 'email')?.trim().toLowerCase();
    if (!email || !email.includes('@')) {
      return jsonResponse({
        type: 4,
        data: {
          content: '请输入有效邮箱，例如：/email email:xxx@yyy.edu.cn',
          flags: 64
        }
      });
    }

    return await sendDiscordVerificationEmail(userId, email, env);
  }

  if (commandName === 'code') {
    const code = getDiscordOptionValue(options, 'code')?.trim();
    if (!code || !/^\d{6}$/.test(code)) {
      return jsonResponse({
        type: 4,
        data: {
          content: '验证码格式不正确，请输入 6 位数字。',
          flags: 64
        }
      });
    }

    const savedCode = await env.AUTH_KV.get(`dc_code_${userId}`);
    if (code !== savedCode) {
      return jsonResponse({
        type: 4,
        data: {
          content: '验证码错误或已过期，请重新使用命令获取新验证码。',
          flags: 64
        }
      });
    }

    const guildId = interaction.guild_id;
    const verifiedRoleId = env.DISCORD_VERIFIED_ROLE_ID;

    if (!guildId || !verifiedRoleId) {
      return jsonResponse({
        type: 4,
        data: {
          content: '验证成功，但无法分配“已验证”身份组。请确认在服务器内使用，并配置 DISCORD_VERIFIED_ROLE_ID。',
          flags: 64
        }
      });
    }

    const roleAssigned = await addDiscordMemberRole(guildId, userId, verifiedRoleId, env);

    if (!roleAssigned) {
      return jsonResponse({
        type: 4,
        data: {
          content: '验证码正确，但身份组分配失败。请检查 Bot 是否拥有管理角色权限，以及角色层级是否高于“已验证”身份组。',
          flags: 64
        }
      });
    }

    await env.AUTH_KV.delete(`dc_code_${userId}`);
    return jsonResponse({
      type: 4,
      data: {
        content: '🎉 验证成功！已为你添加“已验证”身份组，现在可以查看对应频道了。',
        flags: 64
      }
    });
  }

  return jsonResponse({
    type: 4,
    data: {
      content: '未知命令。请使用 /start、/verify、/email、/code。',
      flags: 64
    }
  });
}

function getDiscordOptionValue(options, name) {
  const option = options.find(item => item.name === name);
  return option?.value;
}

async function handleDiscordModalSubmit(interaction, env) {
  const customId = interaction.data?.custom_id;

  if (customId !== 'discord_verify_email_modal') {
    return jsonResponse({
      type: 4,
      data: {
        content: '未知表单。',
        flags: 64
      }
    });
  }

  const userId = interaction.member?.user?.id || interaction.user?.id;
  const email = getDiscordModalValue(interaction.data?.components || [], 'email')?.trim().toLowerCase();

  if (!userId) {
    return jsonResponse({
      type: 4,
      data: {
        content: '无法识别用户身份，请稍后再试。',
        flags: 64
      }
    });
  }

  if (!email || !email.includes('@')) {
    return jsonResponse({
      type: 4,
      data: {
        content: '请输入有效邮箱地址。',
        flags: 64
      }
    });
  }

  return await sendDiscordVerificationEmail(userId, email, env);
}

async function sendDiscordVerificationEmail(userId, email, env) {
  const normalizedEmail = email.trim().toLowerCase();
  const allowedList = (env.ALLOWED_DOMAINS || '')
    .split(',')
    .map(d => d.trim().toLowerCase())
    .filter(Boolean);
  const hasValidDomain = allowedList.some(domain => normalizedEmail.endsWith(domain));

  if (!hasValidDomain) {
    return jsonResponse({
      type: 4,
      data: {
        content: '还不支持该邮箱后缀，请联系管理员添加支持。',
        flags: 64
      }
    });
  }

  const code = Math.floor(100000 + Math.random() * 900000).toString();
  await env.AUTH_KV.put(`dc_code_${userId}`, code, { expirationTtl: 300 });

  const emailSent = await sendResendEmail(normalizedEmail, code, env);
  if (!emailSent) {
    await env.AUTH_KV.delete(`dc_code_${userId}`);
    return jsonResponse({
      type: 4,
      data: {
        content: '邮件发送失败，请稍后再试或联系管理员。',
        flags: 64
      }
    });
  }

  return jsonResponse({
    type: 4,
    data: {
      content: `🔒 仅您可见：验证码已发送至 ${normalizedEmail}，请在此频道继续使用 /code 提交。`,
      flags: 64
    }
  });
}

function createDiscordVerifyModal() {
  return {
    type: 9,
    data: {
      custom_id: 'discord_verify_email_modal',
      title: '邮箱验证',
      components: [
        {
          type: 1,
          components: [
            {
              type: 4,
              custom_id: 'email',
              label: '邮箱地址',
              style: 1,
              placeholder: 'xxx@yyy.edu.cn',
              required: true,
              min_length: 5,
              max_length: 120
            }
          ]
        }
      ]
    }
  };
}

function getDiscordModalValue(components, customId) {
  for (const row of components) {
    const inputs = row?.components || [];
    const field = inputs.find(item => item.custom_id === customId);
    if (field) {
      return field.value;
    }
  }

  return undefined;
}

async function addDiscordMemberRole(guildId, userId, roleId, env) {
  const res = await fetch(
    `https://discord.com/api/v10/guilds/${guildId}/members/${userId}/roles/${roleId}`,
    {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`
      }
    }
  );

  if (!res.ok) {
    console.error('addDiscordMemberRole failed', await res.text());
    return false;
  }

  return true;
}

async function createDiscordInvite(channelId, env) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/invites`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      max_age: 3600,
      max_uses: 1,
      unique: true,
      temporary: false
    })
  });

  if (!res.ok) {
    console.error('createDiscordInvite failed', await res.text());
    return null;
  }

  const data = await res.json();
  return data?.code ? `https://discord.gg/${data.code}` : null;
}

async function verifyDiscordSignature(signature, timestamp, body, publicKeyHex) {
  if (!signature || !timestamp || !body || !publicKeyHex) {
    return false;
  }

  try {
    const encoder = new TextEncoder();
    const keyData = hexToUint8Array(publicKeyHex);
    const sigData = hexToUint8Array(signature);
    const message = encoder.encode(`${timestamp}${body}`);

    const key = await crypto.subtle.importKey(
      'raw',
      keyData,
      { name: 'Ed25519' },
      false,
      ['verify']
    );

    return await crypto.subtle.verify('Ed25519', key, sigData, message);
  } catch (e) {
    console.error('verifyDiscordSignature failed', e);
    return false;
  }
}

function hexToUint8Array(hex) {
  if (hex.length % 2 !== 0) {
    throw new Error('invalid hex string');
  }

  const arr = new Uint8Array(hex.length / 2);
  for (let i = 0; i < hex.length; i += 2) {
    arr[i / 2] = parseInt(hex.slice(i, i + 2), 16);
  }
  return arr;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' }
  });
}

async function setupDiscordCommands(env) {
  if (!env.DISCORD_BOT_TOKEN || !env.DISCORD_APP_ID) {
    return jsonResponse(
      { error: 'Missing DISCORD_BOT_TOKEN or DISCORD_APP_ID' },
      400
    );
  }

  const endpoint = `https://discord.com/api/v10/applications/${env.DISCORD_APP_ID}/commands`;
  const commands = [
    {
      name: 'start',
      type: 1,
      description: '显示验证指引'
    },
    {
      name: 'verify',
      type: 1,
      description: '打开邮箱验证窗口'
    },
    {
      name: 'email',
      type: 1,
      description: '直接提交您的教育邮箱',
      options: [
        {
          type: 3,
          name: 'email',
          description: '您的edu教育邮箱地址',
          required: true
        }
      ]
    },
    {
      name: 'code',
      type: 1,
      description: '提交6位验证代码',
      options: [
        {
          type: 3,
          name: 'code',
          description: '邮箱中的6位代码',
          required: true,
          min_length: 6,
          max_length: 6
        }
      ]
    }
  ];

  try {
    const response = await fetch(endpoint, {
      method: 'PUT',
      headers: {
        'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(commands)
    });

    if (!response.ok) {
      const errorBody = await response.text();
      console.error('Discord API error:', errorBody);
      return jsonResponse(
        {
          error: `Discord API error: HTTP ${response.status}`,
          details: errorBody
        },
        response.status
      );
    }

    const result = await response.json();
    return jsonResponse({
      success: true,
      message: 'Commands registered successfully',
      commands: result
    });
  } catch (error) {
    console.error('Setup failed:', error);
    return jsonResponse(
      { error: 'Setup failed', details: error.message },
      500
    );
  }
}

async function sendResendEmail(toEmail, code, env) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${env.RESEND_API_KEY}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      from: env.FROM_EMAIL,
      to: toEmail,
      subject: '您的验证码 - Dr.Loosen',
      html: `<p>Grüß Gott! 您的 6 位验证码是：<strong>${code}</strong></p><p>请在 5 分钟内完成验证。如不是您本人操作，请忽略此邮件。</p>`
    })
  });

  return res.ok;
}

async function sendTelegramMessage(chatId, text, env) {
  await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      text: text,
      parse_mode: 'HTML'
    })
  });
}

async function sendDiscordChannelMessage(channelId, content, env) {
  const res = await fetch(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: {
      'Authorization': `Bot ${env.DISCORD_BOT_TOKEN}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      content: truncateDiscordContent(content)
    })
  });

  if (!res.ok) {
    console.error('sendDiscordChannelMessage failed', await res.text());
    return false;
  }

  return true;
}

function truncateDiscordContent(content) {
  if (content.length <= 2000) {
    return content;
  }

  return `${content.slice(0, 1997)}...`;
}

async function createInviteLink(chatId, env) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createChatInviteLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: chatId,
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600
    })
  });

  const data = await res.json();
  return data.ok ? data.result.invite_link : null;
}
