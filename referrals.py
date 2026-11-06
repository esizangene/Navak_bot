"""Voluntary Telegram channel referral tracking for NAVAK."""
import os
import sqlite3
from pathlib import Path
from urllib.parse import quote

from telegram import InlineKeyboardButton, InlineKeyboardMarkup

CHANNEL = os.getenv("REQUIRED_CHANNEL", "@musicnavac")
DB_PATH = os.getenv("DATABASE_PATH", "navak.sqlite3")
TARGET = 3


def _db():
    path = Path(DB_PATH)
    if path.parent != Path("."):
        path.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(path), timeout=20)
    conn.execute("""CREATE TABLE IF NOT EXISTS navak_invites (
        invite_url TEXT PRIMARY KEY, owner_id INTEGER NOT NULL, owner_name TEXT NOT NULL
    )""")
    conn.execute("""CREATE TABLE IF NOT EXISTS navak_referrals (
        joined_user_id INTEGER PRIMARY KEY, owner_id INTEGER NOT NULL,
        joined_name TEXT NOT NULL, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )""")
    conn.commit()
    return conn


def count(user_id):
    with _db() as conn:
        return conn.execute(
            "SELECT COUNT(*) FROM navak_referrals WHERE owner_id=?", (user_id,)
        ).fetchone()[0]


async def send_invite(message, user, bot):
    try:
        invite = await bot.create_chat_invite_link(
            chat_id=CHANNEL, name=f"navak-{user.id}"
        )
    except Exception:
        await message.reply_text(
            "ساخت لینک دعوت انجام نشد. ربات باید در کانال مدیر باشد "
            "و مجوز دعوت کاربران داشته باشد."
        )
        return
    with _db() as conn:
        conn.execute(
            "INSERT OR REPLACE INTO navak_invites(invite_url,owner_id,owner_name) VALUES(?,?,?)",
            (invite.invite_link, user.id, user.full_name or ""),
        )
    total = count(user.id)
    share = "https://t.me/share/url?url=" + quote(invite.invite_link, safe="")
    keyboard = InlineKeyboardMarkup([
        [InlineKeyboardButton("اشتراک‌گذاری لینک", url=share)],
        [InlineKeyboardButton("آمار دعوت‌های من", callback_data="navak_ref_stats")],
        [InlineKeyboardButton("برترین معرف‌ها", callback_data="navak_ref_top")],
    ])
    await message.reply_text(
        f"🎁 لینک دعوت اختصاصی تو:\n{invite.invite_link}\n\n"
        f"👥 دعوت‌های تأییدشده: {total}\n"
        f"🎯 هدف مرحله اول: {TARGET}\n"
        f"تا هدف: {max(0, TARGET-total)} نفر\n\n"
        "فقط عضویت واقعی کاربر جدید از همین لینک شمرده می‌شود.",
        reply_markup=keyboard, disable_web_page_preview=True,
    )


async def handle_join(update, context):
    event = update.chat_member
    if not event or not event.invite_link:
        return
    if event.chat.username and event.chat.username.lower() != CHANNEL.lstrip("@").lower():
        return
    old_status = event.old_chat_member.status
    new_status = event.new_chat_member.status
    member_statuses = {"member", "administrator", "creator"}
    if new_status not in member_statuses or old_status in member_statuses:
        return
    invited_user = event.new_chat_member.user
    with _db() as conn:
        owner = conn.execute(
            "SELECT owner_id FROM navak_invites WHERE invite_url=?",
            (event.invite_link.invite_link,),
        ).fetchone()
        if not owner or owner[0] == invited_user.id:
            return
        owner_id = owner[0]
        inserted = conn.execute(
            "INSERT OR IGNORE INTO navak_referrals(joined_user_id,owner_id,joined_name) VALUES(?,?,?)",
            (invited_user.id, owner_id, invited_user.full_name or ""),
        ).rowcount
        total = conn.execute(
            "SELECT COUNT(*) FROM navak_referrals WHERE owner_id=?", (owner_id,)
        ).fetchone()[0]
    if inserted:
        notice = f"🎉 یک عضو جدید با لینک تو به نواک پیوست. مجموع دعوت‌ها: {total}"
        if total == TARGET:
            notice += "\nبه هدف سه دعوت رسیدی؛ برای هماهنگی هدیه با مدیر نواک پیام بده."
        try:
            await context.bot.send_message(owner_id, notice)
        except Exception:
            pass


async def stats_message(user_id):
    total = count(user_id)
    return f"📊 دعوت‌های تأییدشده: {total}\n🎯 هدف مرحله اول: {TARGET}\n👥 باقی‌مانده: {max(0,TARGET-total)}"


def leaderboard():
    with _db() as conn:
        rows = conn.execute(
            "SELECT owner_name,owner_id,COUNT(*) total FROM navak_referrals "
            "GROUP BY owner_id ORDER BY total DESC LIMIT 10"
        ).fetchall()
    if not rows:
        return "هنوز دعوتی ثبت نشده است."
    return "🏆 برترین معرف‌های نواک:\n" + "\n".join(
        f"{i}. {name or ('کاربر '+str(uid))} — {total}"
        for i, (name, uid, total) in enumerate(rows, 1)
    )
