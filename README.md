# Loosen Worker

一个基于 Cloudflare Workers 的轻量机器人服务，支持 Telegram 和 Discord 的可制定白名单邮箱后缀的验证码验证，并可将 Telegram 频道消息转发到 Discord。

## 功能

- Telegram 私聊验证码验证
- Discord 斜杠命令验证（`/start`、`/verify`、`/email`、`/code`）
- Telegram 频道消息转发到 Discord 指定频道
- 自动发送 6 位验证码，5 分钟内有效
- 支持生成 Telegram / Discord 一次性邀请链接

## 使用

1. 部署到 Cloudflare Workers。
2. 配置环境变量和 KV。
3. 访问 `/setup` 注册 Discord 命令。
4. 将 Telegram Webhook 和 Discord Interaction Endpoint 指向此 Worker。

## 环境变量

- `BOT_TOKEN`：Telegram Bot Token，用于发送消息、发验证码和创建邀请链接。
- `AUTH_KV`：Cloudflare KV 命名空间绑定，用于保存验证码。
- `ALLOWED_DOMAINS`：允许的邮箱后缀，多个后缀用英文逗号分隔，例如 `@xxx.edu.cn,@yyy.edu.cn`。
- `RESEND_API_KEY`：Resend API Key，用于发送验证码邮件。
- `FROM_EMAIL`：发件人邮箱，必须是 Resend 已验证的发件地址。
- `DISCORD_BOT_TOKEN`：Discord Bot Token，用于注册命令、发消息和分配身份组。
- `DISCORD_APP_ID`：Discord Application ID，用于注册斜杠命令。
- `DISCORD_PUBLIC_KEY`：Discord 应用公钥，用于校验 Interaction 签名。
- `DISCORD_VERIFIED_ROLE_ID`：验证成功后自动分配的 Discord 身份组 ID。
- `GROUP_ID`：Telegram 群组 ID，用于生成一次性邀请链接。
- `CHANNEL_ID`：Telegram 频道 ID，用于生成一次性邀请链接。
- `TELEGRAM_SOURCE_CHANNEL_ID`：需要转发到 Discord 的 Telegram 频道 ID，不填则不过滤来源频道。
- `DISCORD_FORWARD_CHANNEL_ID`：接收 Telegram 频道转发内容的 Discord 频道 ID。

## 说明

- `GET /setup` 用于注册 Discord 命令。
- `POST /discord` 处理 Discord Interaction。
- 其他 `POST` 请求按 Telegram Webhook 处理。
