const API = "https://api.telegram.org";
const CHANNEL_TEXT = "کانال ناواک";

async function tg(env, method, body) {
  const r = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body)
  });
  const data = await r.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}
async function send(env, chatId, text, keyboard) {
  return tg(env, "sendMessage", {
    chat_id: chatId, text, disable_web_page_preview: true,
    ...(keyboard ? { reply_markup: keyboard } : {})
  });
}
const btn = (text, callback_data) => ({ text, callback_data });
function mainMenu() {
  return { inline_keyboard: [
    [btn("🛒 خرید کانفیگ", "buy"), btn("📦 کانفیگ‌های من", "mine")],
    [btn("🎁 کانفیگ رایگان", "free"), btn("👥 دعوت از دوستان", "invite")],
    [btn("🔄 تمدید کانفیگ", "renew"), btn("🧾 سوابق خرید", "history")],
    [btn("💳 کیف پول", "wallet"), btn("📖 آموزش اتصال", "guide")],
    [btn("☎️ پشتیبانی", "support"), btn("👤 حساب کاربری", "account")]
  ] };
}
async function isMember(env, userId) {
  const m = await tg(env, "getChatMember", { chat_id: env.REQUIRED_CHANNEL || "@musicnavac", user_id: userId });
  return ["member", "administrator", "creator"].includes(m.status) || (m.status === "restricted" && m.is_member === true);
}
async function joinPrompt(env, chatId) {
  await send(env, chatId, "برای استفاده از ناواک ابتدا عضو کانال شوید و سپس عضویت را بررسی کنید.", {
    inline_keyboard: [
      [{ text: "📢 عضویت در کانال ناواک", url: env.CHANNEL_JOIN_URL || "https://t.me/musicnavac" }],
      [btn("✅ بررسی عضویت", "check_join")]
    ]
  });
}
async function userRow(env, user) {
  const id = String(user.id);
  let row = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(id).first();
  if (!row) {
    const ref = user._referrer && String(user._referrer) !== id ? String(user._referrer) : null;
    await env.DB.prepare(
      "INSERT OR IGNORE INTO users (telegram_id, username, first_name, referrer_id) VALUES (?, ?, ?, ?)"
    ).bind(id, user.username || null, user.first_name || null, ref).run();
    row = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(id).first();
  } else {
    await env.DB.prepare("UPDATE users SET username = ?, first_name = ? WHERE telegram_id = ?")
      .bind(user.username || null, user.first_name || null, id).run();
  }
  return row;
}
async function deliverRewards(env, userId) {
  const pending = await env.DB.prepare("SELECT id FROM rewards WHERE user_id = ? AND status = 'pending' ORDER BY id")
    .bind(String(userId)).all();
  let delivered = 0;
  for (const reward of (pending.results || [])) {
    const cfg = await env.DB.prepare(
      "SELECT id, config_text, config_type FROM configs WHERE claimed_by IS NULL AND hours = 1 AND gb = 1 ORDER BY id LIMIT 1"
    ).first();
    if (!cfg) break;
    const claim = await env.DB.prepare("UPDATE configs SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ? AND claimed_by IS NULL")
      .bind(String(userId), cfg.id).run();
    if (!claim.meta?.changes) continue;
    await env.DB.prepare("UPDATE rewards SET status = 'delivered', config_id = ?, delivered_at = CURRENT_TIMESTAMP WHERE id = ? AND status = 'pending'")
      .bind(cfg.id, reward.id).run();
    await send(env, userId, `🎁 جایزه دعوت شما آماده شد!\nنوع: ${cfg.config_type.toUpperCase()}\nحجم: ۱ گیگابایت\nاعتبار: ۱ ساعت\n\nلینک کانفیگ:\n${cfg.config_text}`);
    delivered++;
  }
  return delivered;
}
async function confirmMember(env, user) {
  const row = await userRow(env, user);
  await env.DB.prepare("UPDATE users SET is_member = 1 WHERE telegram_id = ?").bind(String(user.id)).run();
  if (row?.referrer_id && String(row.referrer_id) !== String(user.id)) {
    await env.DB.prepare("INSERT OR IGNORE INTO referrals (referrer_id, invitee_id) VALUES (?, ?)")
      .bind(String(row.referrer_id), String(user.id)).run();
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?")
      .bind(String(row.referrer_id)).first();
    const refUser = await env.DB.prepare("SELECT rewarded_referrals FROM users WHERE telegram_id = ?")
      .bind(String(row.referrer_id)).first();
    const n = Number(count?.n || 0);
    const already = Number(refUser?.rewarded_referrals || 0);
    while (n >= (already + 1) * 3) {
      await env.DB.prepare("INSERT INTO rewards (user_id) VALUES (?)").bind(String(row.referrer_id)).run();
      await env.DB.prepare("UPDATE users SET rewarded_referrals = rewarded_referrals + 1 WHERE telegram_id = ?")
        .bind(String(row.referrer_id)).run();
      break;
    }
    await deliverRewards(env, row.referrer_id);
  }
}
async function showStart(env, chatId, user) {
  await userRow(env, user);
  const text = `🌐 به ربات فروش کانفیگ ناواک خوش آمدید!

با ناواک می‌توانید سفارش کانفیگ‌های VLESS و VMess را ثبت کنید.

🚀 امکانات ربات:
🔹 مشاهده و سفارش کانفیگ VLESS و VMess
🔹 انتخاب حجم و مدت اعتبار
🔹 دریافت لینک اختصاصی پس از تأیید سفارش و موجودی
🔹 مشاهده کانفیگ‌های دریافت‌شده
🔹 تمدید و پیگیری سفارش
🔹 مشاهده سوابق خرید
🔹 دریافت کانفیگ رایگان با دعوت از ۳ کاربر جدید
🔹 راهنمای اتصال و پشتیبانی

🎁 هدیه دعوت:
با معرفی ۳ کاربر جدید که از لینک اختصاصی شما وارد شوند و عضویتشان در کانال تأیید شود، یک کانفیگ ۱ گیگابایتی با اعتبار ۱ ساعت دریافت می‌کنید.

📢 عضویت در کانال @musicnavac برای استفاده از ربات الزامی است.

⚠️ تحویل کانفیگ منوط به موجودی کانفیگ معتبر و تأیید سفارش است.\n\n👇 از منوی زیر استفاده کنید.`;
  await send(env, chatId, text, mainMenu());
}
async function referralPanel(env, chatId, userId) {
  const me = await tg(env, "getMe", {});
  const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?")
    .bind(String(userId)).first();
  const rewards = await env.DB.prepare("SELECT COUNT(*) AS n FROM rewards WHERE user_id = ? AND status = 'delivered'")
    .bind(String(userId)).first();
  const link = `https://t.me/${me.username}?start=ref_${userId}`;
  await send(env, chatId,
    `👥 لینک دعوت اختصاصی شما:\n${link}\n\nدعوت‌های تأییدشده: ${count?.n || 0} نفر\nجایزه‌های دریافت‌شده: ${rewards?.n || 0}\n\nبا هر ۳ دعوت موفق، یک کانفیگ ۱ گیگابایت و ۱ ساعته هدیه می‌گیرید.`,
    { inline_keyboard: [[{ text: "📤 اشتراک‌گذاری لینک", url: `https://t.me/share/url?url=${encodeURIComponent(link)}` }], [btn("🔙 منوی اصلی", "home")]] }
  );
}
async function handleCallback(env, q) {
  const id = q.from.id, chatId = q.message.chat.id, data = q.data || "";
  if (data === "check_join") {
    try {
      if (!(await isMember(env, id))) {
        await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: "هنوز عضویت شما تأیید نشده است.", show_alert: true });
        return;
      }
      await confirmMember(env, q.from);
      await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: "عضویت تأیید شد." });
      await tg(env, "editMessageText", { chat_id: chatId, message_id: q.message.message_id, text: "✅ عضویت شما تأیید شد. از منوی زیر استفاده کنید.", reply_markup: mainMenu() });
    } catch {
      await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: "بررسی عضویت ناموفق بود. ربات باید در کانال ادمین باشد.", show_alert: true });
    }
    return;
  }
  try {
    if (!(await isMember(env, id))) {
      await tg(env, "answerCallbackQuery", { callback_query_id: q.id });
      await joinPrompt(env, chatId); return;
    }
  } catch { await tg(env, "answerCallbackQuery", { callback_query_id: q.id, text: "خطا در بررسی عضویت", show_alert: true }); return; }
  await confirmMember(env, q.from);
  await tg(env, "answerCallbackQuery", { callback_query_id: q.id });
  if (data === "home") return send(env, chatId, "منوی اصلی ناواک:", mainMenu());
  if (data === "buy") return send(env, chatId, "نوع کانفیگ موردنظر را انتخاب کنید:", { inline_keyboard: [[btn("VLESS", "buy:vless"), btn("VMess", "buy:vmess")], [btn("🔙 بازگشت", "home")]] });
  if (data.startsWith("buy:")) {
    const type = data.split(":")[1];
    return send(env, chatId, `🛒 سفارش ${type.toUpperCase()}\n\nپلن موردنظر را انتخاب کنید. پس از ثبت سفارش، برای پرداخت و تأیید با پشتیبانی هماهنگ می‌کنید.\n\nدرگاه پرداخت هنوز به ربات متصل نشده است.`, {
      inline_keyboard: [[btn("۱ گیگ / ۳۰ روز", `order:${type}:30:1`), btn("۵ گیگ / ۳۰ روز", `order:${type}:30:5`)], [btn("۱۰ گیگ / ۳۰ روز", `order:${type}:30:10`)], [btn("🔙 بازگشت", "buy")]]
    });
  }
  if (data.startsWith("order:")) {
    const [, type, hours, gb] = data.split(":");
    await env.DB.prepare("INSERT INTO orders (user_id, config_type, hours, gb) VALUES (?, ?, ?, ?)")
      .bind(String(id), type, Number(hours) * 24, Number(gb)).run();
    return send(env, chatId, "✅ درخواست شما ثبت شد. برای پرداخت و فعال‌سازی با پشتیبانی تماس بگیرید. هنوز درگاه پرداخت خودکار متصل نشده است.", {
      inline_keyboard: [[{ text: "☎️ ارتباط با پشتیبانی", url: env.SUPPORT_URL || "https://t.me/musicnavac" }], [btn("🔙 منوی اصلی", "home")]]
    });
  }
  if (data === "free") {
    const count = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?").bind(String(id)).first();
    const rewards = await env.DB.prepare("SELECT COUNT(*) AS n FROM rewards WHERE user_id = ? AND status = 'pending'").bind(String(id)).first();
    const delivered = await env.DB.prepare("SELECT COUNT(*) AS n FROM rewards WHERE user_id = ? AND status = 'delivered'").bind(String(id)).first();
    await deliverRewards(env, id);
    return send(env, chatId, `🎁 دریافت کانفیگ رایگان\n\nدعوت موفق: ${count?.n || 0} از هر ۳ نفر\nجایزه در انتظار: ${rewards?.n || 0}\nجایزه تحویل‌شده: ${delivered?.n || 0}\n\nبرای دریافت هدیه، ۳ کاربر جدید را با لینک اختصاصی خود دعوت کنید. هر سه نفر باید عضو کانال شوند.\n\nاگر واجد شرایط هستید ولی هدیه موجود نیست، پس از شارژ موجودی به‌صورت خودکار تحویل می‌شود.`, { inline_keyboard: [[btn("👥 لینک دعوت من", "invite")], [btn("🔙 منوی اصلی", "home")]] });
  }
  if (data === "invite") return referralPanel(env, chatId, id);
  if (data === "mine") {
    const rows = await env.DB.prepare("SELECT id, config_type, hours, gb, config_text, claimed_at FROM configs WHERE claimed_by = ? ORDER BY id DESC LIMIT 20").bind(String(id)).all();
    const list = rows.results || [];
    if (!list.length) return send(env, chatId, "هنوز کانفیگی برای شما ثبت نشده است.", { inline_keyboard: [[btn("🛒 خرید کانفیگ", "buy")], [btn("🔙 منوی اصلی", "home")]] });
    for (const c of list) await send(env, chatId, `📦 کانفیگ شماره ${c.id}\nنوع: ${c.config_type.toUpperCase()}\nحجم: ${c.gb} گیگ\nاعتبار ثبت‌شده: ${c.hours} ساعت\n\n${c.config_text}`);
    return;
  }
  if (data === "history") {
    const rows = await env.DB.prepare("SELECT id, config_type, hours, gb, status, created_at FROM orders WHERE user_id = ? ORDER BY id DESC LIMIT 10").bind(String(id)).all();
    const s = (rows.results || []).map(x => `#${x.id} - ${x.config_type.toUpperCase()} - ${x.gb}GB - ${x.hours}h - ${x.status}`).join("\n");
    return send(env, chatId, s ? "🧾 سوابق سفارش شما:\n" + s : "هنوز سفارشی ثبت نکرده‌اید.", { inline_keyboard: [[btn("🔙 منوی اصلی", "home")]] });
  }
  if (data === "account") {
    const u = await env.DB.prepare("SELECT * FROM users WHERE telegram_id = ?").bind(String(id)).first();
    const refs = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals WHERE referrer_id = ?").bind(String(id)).first();
    return send(env, chatId, `👤 حساب کاربری\nشناسه: ${id}\nنام کاربری: ${q.from.username ? "@" + q.from.username : "ثبت نشده"}\nدعوت موفق: ${refs?.n || 0}\nوضعیت عضویت: تأییدشده`, { inline_keyboard: [[btn("🔙 منوی اصلی", "home")]] });
  }
  if (data === "renew") return send(env, chatId, "برای تمدید، ابتدا کانفیگ‌های من را بررسی کنید و سپس شناسه کانفیگ را برای پشتیبانی بفرستید.", { inline_keyboard: [[btn("📦 کانفیگ‌های من", "mine")], [btn("☎️ پشتیبانی", "support")], [btn("🔙 منوی اصلی", "home")]] });
  if (data === "wallet") return send(env, chatId, "💳 کیف پول هنوز به درگاه پرداخت متصل نشده است. برای پرداخت با پشتیبانی هماهنگ کنید.", { inline_keyboard: [[btn("☎️ پشتیبانی", "support")], [btn("🔙 منوی اصلی", "home")]] });
  if (data === "guide") return send(env, chatId, "📖 آموزش اتصال:\n۱. یک برنامه سازگار با VLESS یا VMess نصب کنید.\n۲. لینک کانفیگ را کپی کنید.\n۳. در برنامه گزینه افزودن از کلیپ‌بورد را بزنید.\n۴. پروفایل را انتخاب و اتصال را فعال کنید.", { inline_keyboard: [[btn("🔙 منوی اصلی", "home")]] });
  if (data === "support") return send(env, chatId, "☎️ برای پشتیبانی از طریق دکمه زیر پیام دهید.", { inline_keyboard: [[{ text: "ارتباط با پشتیبانی", url: env.SUPPORT_URL || "https://t.me/musicnavac" }], [btn("🔙 منوی اصلی", "home")]] });
}
function isAdmin(env, id) {
  const configured = (env.ADMIN_IDS || "").split(",").map(x => x.trim()).filter(Boolean);
  return configured.includes(String(id)) || String(id) === "8755875032";
}
async function handleMessage(env, m) {
  const chatId = m.chat.id, user = m.from, text = (m.text || "").trim();
  if (!text) return;
  if (text === "/myid") return send(env, chatId, `شناسه تلگرام شما: ${user.id}`);
  if (text.startsWith("/start")) {
    const payload = text.split(/\s+/, 2)[1] || "";
    const ref = payload.startsWith("ref_") ? payload.slice(4) : null;
    await userRow(env, { ...user, _referrer: ref });
    try {
      if (!(await isMember(env, user.id))) return joinPrompt(env, chatId);
      await confirmMember(env, user);
      return showStart(env, chatId, user);
    } catch { return send(env, chatId, "امکان بررسی عضویت نیست. مدیر باید ربات را در کانال @musicnavac ادمین کند."); }
  }
  if (text === "/help") {
    try {
      if (!(await isMember(env, user.id))) return joinPrompt(env, chatId);
      await confirmMember(env, user);
      return showStart(env, chatId, user);
    } catch { return send(env, chatId, "امکان بررسی عضویت نیست. مدیر باید ربات را در کانال @musicnavac ادمین کند."); }
  }
  if (text.startsWith("/")) {
    if ((text === "/configs" || text === "/admin") && isAdmin(env, user.id)) {
      const total = await env.DB.prepare("SELECT COUNT(*) AS n FROM configs WHERE claimed_by IS NULL").first();
      const rows = await env.DB.prepare("SELECT id, config_type, hours, gb, config_text FROM configs WHERE claimed_by IS NULL ORDER BY id LIMIT 30").all();
      const list = rows.results || [];
      if (!list.length) return send(env, chatId, "📦 موجودی کانفیگ خالی است.\nبرای افزودن کانفیگ معتبر از دستور /addconfig استفاده کنید.");
      await send(env, chatId, `🔐 پنل مدیر ناواک\nکانفیگ‌های آزاد: ${total?.n || 0}\nنمایش حداکثر ۳۰ مورد اول.\n\nاین لینک‌ها از موجودی کم نمی‌شوند و فقط برای مشاهده مدیر هستند.`);
      for (const cfg of list) {
        await send(env, chatId, `📦 کانفیگ شماره ${cfg.id}\nنوع: ${String(cfg.config_type).toUpperCase()}\nحجم: ${cfg.gb} گیگ\nاعتبار: ${cfg.hours} ساعت\n\n${cfg.config_text}`);
      }
      return;
    }
    if (text.startsWith("/stats") && isAdmin(env, user.id)) {
      const u = await env.DB.prepare("SELECT COUNT(*) AS n FROM users").first();
      const c = await env.DB.prepare("SELECT COUNT(*) AS n FROM configs WHERE claimed_by IS NULL").first();
      const r = await env.DB.prepare("SELECT COUNT(*) AS n FROM referrals").first();
      return send(env, chatId, `📊 آمار ناواک\nکاربران: ${u?.n || 0}\nدعوت‌های تأییدشده: ${r?.n || 0}\nکانفیگ‌های موجود: ${c?.n || 0}`);
    }
    if (text.startsWith("/addconfig") && isAdmin(env, user.id)) {
      const p = text.split(/\s+/);
      if (p.length < 5 || !["vless", "vmess"].includes(p[1].toLowerCase()) || !/^(vless|vmess):\/\//i.test(p.slice(4).join(" "))) {
        return send(env, chatId, "فرمت صحیح:\n/addconfig vless 1 1 https://...\nیا\n/addconfig vmess 24 1 https://...\n(نوع، ساعت، گیگ، لینک کانفیگ)");
      }
      await env.DB.prepare("INSERT INTO configs (config_type, hours, gb, config_text) VALUES (?, ?, ?, ?)")
        .bind(p[1].toLowerCase(), Number(p[2]), Number(p[3]), p.slice(4).join(" ")).run();
      const delivered = await deliverPendingAll(env);
      return send(env, chatId, `✅ کانفیگ به موجودی اضافه شد.\nجایزه‌های خودکار تحویل‌شده: ${delivered}`);
    }
    if (text.startsWith("/assign") && isAdmin(env, user.id)) {
      const p = text.split(/\s+/);
      if (p.length !== 3) return send(env, chatId, "فرمت: /assign شناسه_کاربر شناسه_کانفیگ");
      const cfg = await env.DB.prepare("SELECT * FROM configs WHERE id = ? AND claimed_by IS NULL").bind(Number(p[2])).first();
      if (!cfg) return send(env, chatId, "کانفیگ موجود نیست یا قبلاً تحویل شده است.");
      const upd = await env.DB.prepare("UPDATE configs SET claimed_by = ?, claimed_at = CURRENT_TIMESTAMP WHERE id = ? AND claimed_by IS NULL").bind(p[1], cfg.id).run();
      if (!upd.meta?.changes) return send(env, chatId, "این کانفیگ هم‌زمان تحویل شده است.");
      await send(env, p[1], `✅ کانفیگ شما آماده است\nنوع: ${cfg.config_type.toUpperCase()}\nحجم: ${cfg.gb} گیگ\nاعتبار: ${cfg.hours} ساعت\n\n${cfg.config_text}`);
      return send(env, chatId, "کانفیگ تحویل داده شد.");
    }
    return;
  }
  try {
    if (!(await isMember(env, user.id))) return joinPrompt(env, chatId);
    await confirmMember(env, user);
    return send(env, chatId, "از دکمه‌های منوی ناواک استفاده کنید.", mainMenu());
  } catch { return send(env, chatId, "خطا در بررسی عضویت. ربات باید در کانال @musicnavac ادمین باشد."); }
}
async function deliverPendingAll(env) {
  const users = await env.DB.prepare("SELECT DISTINCT user_id FROM rewards WHERE status = 'pending'").all();
  let total = 0;
  for (const u of users.results || []) total += await deliverRewards(env, u.user_id);
  return total;
}
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    if (request.method === "GET" && url.pathname === "/health") return new Response("NAVAK sales bot ready", { status: 200 });
    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!env.WEBHOOK_SECRET || request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) return new Response("Unauthorized", { status: 401 });
      if (!env.TELEGRAM_BOT_TOKEN || !env.REQUIRED_CHANNEL || !env.DB) return new Response("Worker is not configured", { status: 503 });
      try {
        const update = await request.json();
        if (update.callback_query) await handleCallback(env, update.callback_query);
        else if (update.message) await handleMessage(env, update.message);
      } catch (e) { console.error("NAVAK error", e?.message || String(e)); }
      return new Response("OK");
    }
    return new Response("NAVAK");
  }
};