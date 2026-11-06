# راه‌اندازی نواک روی Cloudflare Workers (رایگان)

## ۱) ساخت Worker از GitHub
1. در Cloudflare وارد **Workers & Pages** شو.
2. **Create application** را بزن.
3. بخش **Workers** و گزینه اتصال/واردکردن از **GitHub** را انتخاب کن.
4. مخزن **esizangene/Navak_bot** و شاخه **main** را انتخاب کن.
5. نام Worker باید دقیقاً **navak-bot** باشد.
6. مسیر پروژه را ریشه مخزن بگذار. فایل `wrangler.toml` در ریشه قرار دارد.
7. Build command را خالی بگذار و Deploy command را روی مقدار پیش‌فرض `npx wrangler deploy` بگذار.
8. **Save and Deploy** را بزن.

## ۲) افزودن متغیرهای محرمانه
در Worker به **Settings > Variables and Secrets** برو و این مقادیر را اضافه کن. مقادیر محرمانه را در چت یا GitHub قرار نده.

- `TELEGRAM_BOT_TOKEN` — توکن ربات از BotFather؛ نوع Secret
- `REQUIRED_CHANNEL` — مقدار `@musicnavac`
- `CHANNEL_JOIN_URL` — مقدار `https://t.me/musicnavac`
- `WEBHOOK_SECRET` — یک رشته تصادفی و محرمانه (فقط حروف انگلیسی و عدد و زیرخط؛ ۳۲ تا ۶۴ کاراکتر)
- `SETUP_KEY` — یک کلید تصادفی جداگانه و موقت؛ نوع Secret

پس از ذخیره تغییرات، Worker را دوباره Deploy کن.

## ۳) ثبت Webhook تلگرام
پس از Deploy، نشانی Worker را از داشبورد بردار؛ معمولاً به شکل `https://navak-bot.<subdomain>.workers.dev` است.
در مرورگر این نشانی را باز کن و به انتهای آن مسیر زیر را اضافه کن:
`/setup?key=YOUR_SETUP_KEY`
به جای `YOUR_SETUP_KEY` کلیدی را قرار بده که خودت در Secret با نام `SETUP_KEY` گذاشتی.
اگر پاسخ `{"ok":true,"webhook":true}` دیدی، ثبت Webhook انجام شده است.
بعد از موفقیت، Secret با نام `SETUP_KEY` را از تنظیمات حذف کن و دوباره Deploy کن. `WEBHOOK_SECRET` را حذف نکن؛ برای محافظت از Webhook لازم است.

## ۴) آزمایش
نشانی `https://navak-bot.<subdomain>.workers.dev/health` باید عبارت `NAVAK worker is ready` را نشان دهد.
سپس در تلگرام به `@musicnavacbot` پیام `/start` بده. برای بررسی عضویت، ربات باید در کانال `@musicnavac` مدیر باشد.

## نکته
این نسخه شامل شروع ربات، بررسی عضویت کانال، جست‌وجوی آهنگ با iTunes و نمایش پیوند رسمی/پیش‌نمایش است. سیستم دعوت و امتیازدهی نسخه قبلی هنوز به این Worker منتقل نشده است.
