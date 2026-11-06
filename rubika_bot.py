import asyncio
import logging
import os
from urllib.parse import quote

import httpx

logging.basicConfig(level=logging.INFO)
log = logging.getLogger("navak-rubika")

TOKEN = os.getenv("RUBIKA_BOT_TOKEN", "").strip()
BASE = f"https://botapi.rubika.ir/v3/{TOKEN}"


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
        part = (
            f"🎵 {item.get('trackName', 'بدون نام')}\n"
            f"🎤 {item.get('artistName', 'خواننده نامشخص')}\n"
            f"💿 {item.get('collectionName', 'آلبوم نامشخص')}"
        )
        if item.get("trackViewUrl"):
            part += f"\n🔗 صفحه رسمی: {item['trackViewUrl']}"
        if item.get("previewUrl"):
            part += f"\n▶️ پیش‌نمایش مجاز: {item['previewUrl']}"
        messages.append(part)
    return "\n\n".join(messages)


async def api(client, method: str, payload=None):
    response = await client.post(f"{BASE}/{method}", json=payload or {})
    response.raise_for_status()
    body = response.json()
    if body.get("status") not in (None, "OK"):
        raise RuntimeError(f"Rubika API error: {body}")
    return body.get("data", body)


async def main():
    if not TOKEN:
        raise RuntimeError("Set RUBIKA_BOT_TOKEN in the hosting environment.")
    offset_id = None
    async with httpx.AsyncClient(timeout=30) as client:
        me = await api(client, "getMe")
        log.info("Rubika bot connected: %s", me.get("bot", {}).get("username", "unknown"))
        while True:
            try:
                payload = {"limit": 10}
                if offset_id:
                    payload["offset_id"] = offset_id
                result = await api(client, "getUpdates", payload)
                for update in result.get("updates", []):
                    if update.get("type") != "NewMessage":
                        continue
                    message = update.get("new_message") or {}
                    if message.get("sender_type") == "Bot":
                        continue
                    chat_id = update.get("chat_id")
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
                    await api(client, "sendMessage", {"chat_id": chat_id, "text": reply})
                offset_id = result.get("next_offset_id") or offset_id
                await asyncio.sleep(2)
            except Exception:
                log.exception("Rubika polling failed")
                await asyncio.sleep(5)


if __name__ == "__main__":
    asyncio.run(main())
