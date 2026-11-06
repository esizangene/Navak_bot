import asyncio
import logging
import os
from urllib.parse import quote

import httpx

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("navak-bale")

TOKEN = os.getenv("BALE_BOT_TOKEN", "").strip()
BASE = f"https://tapi.bale.ai/bot{TOKEN}"
OFFSET = 0


async def search_music(term: str) -> str:
    url = "https://itunes.apple.com/search?term=" + quote(term) + "&entity=song&limit=5"
    async with httpx.AsyncClient(timeout=15) as client:
        response = await client.get(url)
        response.raise_for_status()
        items = response.json().get("results", [])
    if not items:
        return "نتیجه‌ای پیدا نشد؛ نام آهنگ یا خواننده را دقیق‌تر بفرست."
    messages = []
    for item in items[:5]:
        title = item.get("trackName", "بدون نام")
        artist = item.get("artistName", "خواننده نامشخص")
        album = item.get("collectionName", "آلبوم نامشخص")
        part = f"🎵 {title}\n🎤 {artist}\n💿 {album}"
        if item.get("trackViewUrl"):
            part += f"\n🔗 صفحه رسمی: {item['trackViewUrl']}"
        if item.get("previewUrl"):
            part += f"\n▶️ پیش‌نمایش مجاز: {item['previewUrl']}"
        messages.append(part)
    return "\n\n".join(messages)


async def api(client, method: str, payload=None):
    response = await client.post(f"{BASE}/{method}", json=payload or {})
    response.raise_for_status()
    data = response.json()
    if not data.get("ok", False):
        raise RuntimeError(f"Bale API error: {data}")
    return data.get("result", {})


async def main():
    global OFFSET
    if not TOKEN:
        raise RuntimeError("Set BALE_BOT_TOKEN in the hosting environment.")
    async with httpx.AsyncClient(timeout=35) as client:
        me = await api(client, "getMe")
        log.info("Bale bot started: %s", me.get("username", "unknown"))
        while True:
            try:
                result = await api(client, "getUpdates", {"offset": OFFSET, "timeout": 25})
                for update in result.get("updates", []):
                    OFFSET = max(OFFSET, int(update.get("update_id", 0)) + 1)
                    message = update.get("message") or {}
                    chat_id = (message.get("chat") or {}).get("id")
                    text = (message.get("text") or "").strip()
                    if not chat_id or not text:
                        continue
                    if text.startswith("/start"):
                        reply = "🎧 به نواک خوش آمدی! نام آهنگ یا خواننده را بفرست تا جست‌وجو کنم.\nفقط لینک رسمی و پیش‌نمایش مجاز نمایش داده می‌شود."
                    elif text.startswith("/help"):
                        reply = "نام آهنگ یا خواننده را بفرست تا جست‌وجو کنم."
                    else:
                        try:
                            reply = await search_music(text)
                        except Exception:
                            log.exception("Music search failed")
                            reply = "جست‌وجو موقتاً با خطا روبه‌رو شد؛ کمی بعد دوباره امتحان کن."
                    await api(client, "sendMessage", {"chat_id": chat_id, "text": reply, "disable_web_page_preview": True})
            except Exception:
                log.exception("Bale polling failed")
                await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
