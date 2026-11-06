import os
import logging
from urllib.parse import quote
import httpx
from telegram import Update, InlineKeyboardButton, InlineKeyboardMarkup
from telegram.ext import Application, CommandHandler, MessageHandler, ContextTypes, filters

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("navak")

TOKEN = os.getenv("TELEGRAM_BOT_TOKEN", "").strip()
CHANNEL = os.getenv("REQUIRED_CHANNEL", "").strip()
JOIN_URL = os.getenv("CHANNEL_JOIN_URL", "").strip()

def join_url():
    if JOIN_URL:
        return JOIN_URL
    return "https://t.me/" + CHANNEL.lstrip("@")

async def is_member(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    user = update.effective_user
    chat_id = update.effective_chat.id if update.effective_chat else None
    if not user or not CHANNEL:
        return False
    try:
        member = await context.bot.get_chat_member(CHANNEL, user.id)
        return member.status in ("member", "administrator", "creator")
    except Exception as exc:
        log.warning("Membership check failed: %s", exc)
        if chat_id:
            await context.bot.send_message(
                chat_id,
                "فعلاً امکان بررسی عضویت نیست. مدیر ربات باید ربات را در کانال ادمین کند و شناسه کانال را بررسی کند."
            )
        return False

async def gate(update: Update, context: ContextTypes.DEFAULT_TYPE) -> bool:
    if await is_member(update, context):
        return True
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("عضویت در کانال نواک", url=join_url())],
        [InlineKeyboardButton("بررسی عضویت", callback_data="check_join")]
    ])
    if update.effective_message:
        await update.effective_message.reply_text(
            "🎵 برای استفاده از نواک، ابتدا عضو کانال تلگرام ما شو و بعد «بررسی عضویت» را بزن.",
            reply_markup=keyboard
        )
    return False

async def start(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await gate(update, context):
        return
    await update.effective_message.reply_text(
        "🎧 به نواک خوش آمدی!\nنام آهنگ یا خواننده را بفرست تا جست‌وجو کنم.\n"
        "فعلاً نتایج و پیش‌نمایش‌های مجاز نمایش داده می‌شوند؛ دریافت فایل فقط با مجوز صاحب اثر."
    )

async def check_join(update: Update, context: ContextTypes.DEFAULT_TYPE):
    query = update.callback_query
    await query.answer()
    try:
        member = await context.bot.get_chat_member(CHANNEL, query.from_user.id)
        if member.status in ("member", "administrator", "creator"):
            await query.edit_message_text("✅ عضویت تأیید شد. حالا /start را بزن و نام آهنگ را جست‌وجو کن.")
        else:
            await query.answer("هنوز عضویت تأیید نشده است.", show_alert=True)
    except Exception:
        await query.answer("بررسی عضویت انجام نشد؛ مدیر باید ربات را ادمین کانال کند.", show_alert=True)

async def search_music(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not await gate(update, context):
        return
    term = (update.effective_message.text or "").strip()
    if not term:
        return
    url = "https://itunes.apple.com/search?term=" + quote(term) + "&entity=song&limit=5"
    try:
        async with httpx.AsyncClient(timeout=12) as client:
            response = await client.get(url)
            response.raise_for_status()
            items = response.json().get("results", [])
        if not items:
            await update.effective_message.reply_text("نتیجه‌ای پیدا نشد؛ نام خواننده یا آهنگ را دقیق‌تر بفرست.")
            return
        for item in items[:5]:
            title = item.get("trackName", "بدون نام")
            artist = item.get("artistName", "خواننده نامشخص")
            album = item.get("collectionName", "آلبوم نامشخص")
            preview = item.get("previewUrl")
            link = item.get("trackViewUrl")
            text = f"🎵 {title}\n🎤 {artist}\n💿 {album}"
            if link:
                text += f"\n🔗 صفحه رسمی: {link}"
            if preview:
                text += f"\n▶️ پیش‌نمایش مجاز: {preview}"
            await update.effective_message.reply_text(text, disable_web_page_preview=True)
    except Exception:
        log.exception("Search failed")
        await update.effective_message.reply_text("جست‌وجو موقتاً با خطا روبه‌رو شد. کمی بعد دوباره امتحان کن.")

def main():
    if not TOKEN or not CHANNEL or "YOUR_CHANNEL" in CHANNEL:
        raise RuntimeError("Set TELEGRAM_BOT_TOKEN and REQUIRED_CHANNEL in environment variables.")
    app = Application.builder().token(TOKEN).build()
    app.add_handler(CommandHandler("start", start))
    app.add_handler(MessageHandler(filters.TEXT & ~filters.COMMAND, search_music))
    app.add_handler(__import__("telegram.ext", fromlist=["CallbackQueryHandler"]).CallbackQueryHandler(check_join, pattern="^check_join$"))
    log.info("Navak Telegram bot is starting")
    app.run_polling()

if __name__ == "__main__":
    main()
