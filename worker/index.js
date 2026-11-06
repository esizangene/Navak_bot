const API = "https://api.telegram.org";

async function tg(env, method, body) {
  const response = await fetch(`${API}/bot${env.TELEGRAM_BOT_TOKEN}/${method}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await response.json();
  if (!data.ok) throw new Error(data.description || "Telegram API error");
  return data.result;
}

async function sendText(env, chatId, text, replyMarkup) {
  return tg(env, "sendMessage", {
    chat_id: chatId,
    text,
    ...(replyMarkup ? { reply_markup: replyMarkup } : {}),
    disable_web_page_preview: true,
  });
}

async function isMember(env, userId) {
  const member = await tg(env, "getChatMember", {
    chat_id: env.REQUIRED_CHANNEL,
    user_id: userId,
  });
  return ["member", "administrator", "creator"].includes(member.status);
}

async function showJoinPrompt(env, chatId) {
  const joinUrl = env.CHANNEL_JOIN_URL || `https://t.me/${env.REQUIRED_CHANNEL.replace(/^@/, "")}`;
  await sendText(env, chatId,
    "🎵 برای استفاده از نواک، ابتدا عضو کانال شو و بعد «بررسی عضویت» را بزن.",
    { inline_keyboard: [
      [{ text: "عضویت در کانال نواک", url: joinUrl }],
      [{ text: "بررسی عضویت", callback_data: "check_join" }],
    ] }
  );
}

async function handleUpdate(update, env) {
  if (update.callback_query) {
    const q = update.callback_query;
    if (q.data === "check_join") {
      try {
        if (await isMember(env, q.from.id)) {
          await tg(env, "answerCallbackQuery", { callback_query_id: q.id });
          await tg(env, "editMessageText", {
            chat_id: q.message.chat.id,
            message_id: q.message.message_id,
            text: "✅ عضویت تأیید شد. حالا /start را بزن و نام آهنگ را جست‌وجو کن.",
          });
        } else {
          await tg(env, "answerCallbackQuery", {
            callback_query_id: q.id,
            text: "هنوز عضویت تأیید نشده است.",
            show_alert: true,
          });
        }
      } catch {
        await tg(env, "answerCallbackQuery", {
          callback_query_id: q.id,
          text: "بررسی عضویت انجام نشد؛ مدیر باید ربات را ادمین کانال کند.",
          show_alert: true,
        });
      }
    } else {
      await tg(env, "answerCallbackQuery", { callback_query_id: q.id });
    }
    return;
  }

  const message = update.message;
  if (!message?.chat?.id || !message.from) return;
  const chatId = message.chat.id;
  const text = (message.text || "").trim();
  if (!text) return;

  if (text === "/start" || text === "/help") {
    try {
      if (!(await isMember(env, message.from.id))) {
        await showJoinPrompt(env, chatId);
        return;
      }
    } catch {
      await sendText(env, chatId,
        "فعلاً امکان بررسی عضویت نیست. مدیر ربات باید آن را در کانال ادمین کند.");
      return;
    }
    await sendText(env, chatId,
      "🎧 به نواک خوش آمدی!\nنام آهنگ یا خواننده را بفرست تا جست‌وجو کنم.\n\nفعلاً پیش‌نمایش‌ها و پیوندهای رسمی نمایش داده می‌شوند.");
    return;
  }

  if (text.startsWith("/")) return;

  try {
    if (!(await isMember(env, message.from.id))) {
      await showJoinPrompt(env, chatId);
      return;
    }
  } catch {
    await sendText(env, chatId,
      "فعلاً امکان بررسی عضویت نیست. مدیر ربات باید آن را در کانال ادمین کند.");
    return;
  }

  try {
    const url = new URL("https://itunes.apple.com/search");
    url.searchParams.set("term", text);
    url.searchParams.set("entity", "song");
    url.searchParams.set("limit", "5");
    const response = await fetch(url);
    if (!response.ok) {
      console.error("NAVAK music search HTTP error", {
        status: response.status,
        statusText: response.statusText,
      });
      throw new Error(`Music search HTTP ${response.status}`);
    }
    const payload = await response.json();
    const items = payload.results || [];
    console.log("NAVAK music search completed", {
      resultCount: items.length,
      termLength: text.length,
    });
    if (!items.length) {
      await sendText(env, chatId, "نتیجه‌ای پیدا نشد؛ نام آهنگ یا خواننده را دقیق‌تر بفرست.");
      return;
    }
    for (const item of items.slice(0, 5)) {
      const lines = [
        `🎵 ${item.trackName || "بدون نام"}`,
        `🎤 ${item.artistName || "خواننده نامشخص"}`,
        `💿 ${item.collectionName || "آلبوم نامشخص"}`,
      ];
      if (item.trackViewUrl) lines.push(`🔗 صفحه رسمی: ${item.trackViewUrl}`);
      if (item.previewUrl) lines.push(`▶️ پیش‌نمایش: ${item.previewUrl}`);
      await sendText(env, chatId, lines.join("\n"));
    }
  } catch (error) {
    console.error("NAVAK music search failed", {
      name: error?.name || "Error",
      message: error?.message || String(error),
    });
    await sendText(env, chatId, "جست‌وجو موقتاً با خطا روبه‌رو شد. کمی بعد دوباره امتحان کن.");
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/health") {
      return new Response("NAVAK worker is ready", { status: 200 });
    }

    if (request.method === "GET" && url.pathname === "/setup") {
      const key = url.searchParams.get("key");
      if (!env.SETUP_KEY || key !== env.SETUP_KEY) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env.TELEGRAM_BOT_TOKEN || !env.REQUIRED_CHANNEL) {
        return new Response("Missing required secrets", { status: 400 });
      }
      const result = await tg(env, "setWebhook", {
        url: `${url.origin}/telegram`,
        secret_token: env.WEBHOOK_SECRET,
        allowed_updates: ["message", "callback_query"],
        drop_pending_updates: false,
      });
      return Response.json({ ok: true, webhook: result });
    }

    if (request.method === "POST" && url.pathname === "/telegram") {
      if (!env.WEBHOOK_SECRET ||
          request.headers.get("X-Telegram-Bot-Api-Secret-Token") !== env.WEBHOOK_SECRET) {
        return new Response("Unauthorized", { status: 401 });
      }
      if (!env.TELEGRAM_BOT_TOKEN || !env.REQUIRED_CHANNEL) {
        return new Response("Worker is not configured", { status: 503 });
      }
      try {
        const update = await request.json();
        await handleUpdate(update, env);
        return new Response("OK");
      } catch (error) {
        console.error("NAVAK update failed", error);
        return new Response("OK");
      }
    }

    return new Response("NAVAK");
  },
};
