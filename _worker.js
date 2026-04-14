export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    try {
      const payload = await request.json();
      if (payload.message) {
        await handleMessage(payload.message, env);
      }
    } catch (e) {
      console.error(e);
    }

    return new Response('OK');
  }
};

async function handleMessage(message, env) {
  const chatId = message.chat.id;
  const chatType = message.chat.type;
  const text = message.text?.trim();
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
      const inviteLink = await createInviteLink(env);
      if (inviteLink) {
        await sendTelegramMessage(chatId, `🎉 验证成功！\n\n点击下方链接加入群组（一次性链接，1小时内有效）：\n${inviteLink}`, env);
        await env.AUTH_KV.delete(`code_${chatId}`);
      } else {
        await sendTelegramMessage(chatId, "❌ 无法生成邀请链接， Bot 是否具有管理员权限？", env);
      }
    } else {
      await sendTelegramMessage(chatId, "⚠️ 验证码错误或已过期，请重新输入或发送邮箱获取新验证码", env);
    }
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

// 创建单次使用的群组邀请链接
async function createInviteLink(env) {
  const res = await fetch(`https://api.telegram.org/bot${env.BOT_TOKEN}/createChatInviteLink`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.GROUP_ID,
      member_limit: 1,
      expire_date: Math.floor(Date.now() / 1000) + 3600
    })
  });
  
  const data = await res.json();
  return data.ok ? data.result.invite_link : null;
}