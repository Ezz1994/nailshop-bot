// services/botService.js

require("dotenv").config();

const twilio = require("twilio");
const { DateTime } = require("luxon");
const {
  makeBooking,
  upcomingBookings,
  cancelBooking,
  updateBooking,
  getBookingDetails,
} = require("./bookingService");

const { listServices, buildServiceMenuText } = require("./serviceService");
const {
  parseDate,
  parseDatePreservingTime,
  containsTimeInfo,
  containsDateInfo,
} = require("../utils/dateUtils");

const { talkToGPT } = require("../utils/gptUtils");

// In-memory cache (optional, or move to cache.js)
const cache = new Map();

const TIME_ZONE = "Asia/Amman";

// Main Express handler for incoming WhatsApp webhook POST
async function handleIncomingMessage(req, res) {
  const sig = req.headers["x-twilio-signature"];
  if (sig) {
    const url = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const ok = twilio.validateRequest(
      process.env.TWILIO_AUTH_TOKEN,
      sig,
      url,
      req.body
    );
    if (!ok) return res.status(403).send("Invalid signature");
  }

  const incomingMsg = (req.body.Body || "").trim();
  const fromPhone = (req.body.From || "").replace("whatsapp:", "");

  // Cancel intent detection
  if (/\b(cancel|delete|remove)\b/i.test(incomingMsg)) {
    cache.set(`${fromPhone}-mode`, "cancel");
    const bookings = await upcomingBookings(fromPhone);
    if (bookings.length === 0) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("😶‍🌫️ You have no upcoming bookings to cancel.");
      return res.type("text/xml").send(twiml.toString());
    } else if (bookings.length === 1) {
      const svcNames = bookings[0].services.map(s => s.name_en).join(", ");
      const when = DateTime.fromJSDate(new Date(bookings[0].start_at))
        .setZone(TIME_ZONE)
        .toFormat("ccc d LLL HH:mm");
      cache.set(fromPhone, [bookings[0].id]);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(
        `You have one booking: ${svcNames} on ${when}. Cancel it? (yes / no)`
      );
      return res.type("text/xml").send(twiml.toString());
    } else {
      cache.set(fromPhone, bookings.map(r => r.id));
      const listTxt = bookings
        .map((r, i) => {
          const when = DateTime.fromJSDate(new Date(r.start_at))
            .setZone(TIME_ZONE)
            .toFormat("ccc d LLL HH:mm");
          const svcNames = r.services.map(s => s.name_en).join(", ");
          return `${i + 1}️⃣ ${svcNames} – ${when}`;
        })
        .join("\n");
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(
        `Which booking do you want to cancel? Reply with a number:\n${listTxt}`
      );
      return res.type("text/xml").send(twiml.toString());
    }
  }

  // Detect update/cancel mode for multi-step flows
  if (/\b(update|modify|change|reschedule|edit)\b/i.test(incomingMsg)) {
    cache.set(`${fromPhone}-mode`, "update");
  } else if (/\b(cancel|delete|remove)\b/i.test(incomingMsg)) {
    cache.set(`${fromPhone}-mode`, "cancel");
  }

  // Quick update for a single booking
  const one = cache.get(fromPhone);
  const mode1 = cache.get(`${fromPhone}-mode`);
  if (mode1 === "update" && one && one.length === 1) {
    const serviceNamesList = await listServices();
    const mentionedServices = [];
    for (const service of serviceNamesList) {
      const regex = new RegExp(`\\b${service.name_en.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i");
      if (regex.test(incomingMsg)) {
        mentionedServices.push(service);
      }
    }
    // Date/time change?
    let newISO = null;
    if (
      /(change time|move to|tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|am|pm|\d{1,2}(:\d{2})?)/i.test(
        incomingMsg
      )
    ) {
      try {
        const existingBooking = await getBookingDetails(one[0]);
        newISO = parseDatePreservingTime(incomingMsg, existingBooking.start_at);
      } catch (error) {
        console.error("Quick update (date/time) error:", error);
      }
    }
    if (mentionedServices.length > 0 || newISO) {
      try {
        await updateBooking({
          id: one[0],
          newStartISO: newISO,
          newServices: mentionedServices.length > 0 ? mentionedServices.map((s) => s.name_en) : undefined,
        });
        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        let msg = "🔄 Updated!";
        if (newISO) {
          const newTime = DateTime.fromISO(newISO).setZone(TIME_ZONE).toFormat("ccc d LLL HH:mm");
          msg += ` New time: ${newTime}.`;
        }
        if (mentionedServices.length > 0) {
          msg += ` New services: ${mentionedServices.map((s) => s.name_en).join(", ")}.`;
        }
        msg += " Anything else?";
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(msg);
        return res.type("text/xml").send(twiml.toString());
      } catch (error) {
        console.error("Quick service+date update error:", error);
      }
    }
  }

  // Handle yes/no responses for single-booking cancel/update
  const yesRe = /\b(yes|y|نعم|اي|أيوه)\b/i;
  const noRe = /\b(no|n|لا|لأ|مش)\b/i;
  const allRe = /^(all|.*\b(cancel|yes)\s+all\b.*)$/i;
  const pendingArr = cache.get(fromPhone);
  const mode = cache.get(`${fromPhone}-mode`);

  if (pendingArr && pendingArr.length === 1) {
    if (yesRe.test(incomingMsg)) {
      if (mode === "update") {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(
          "What would you like to update? You can say:\n" +
            "• 'Change time to 3pm'\n" +
            "• 'Move to tomorrow'\n" +
            "• 'Change service to pedicure'\n" +
            "• Or tell me the new time and service together"
        );
        return res.type("text/xml").send(twiml.toString());
      } else {
        await cancelBooking(pendingArr[0]);
        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("🗑️ Cancelled! Hope to see you another time.");
        return res.type("text/xml").send(twiml.toString());
      }
    }
    if (noRe.test(incomingMsg)) {
      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("Okay, your booking remains unchanged 👍");
      return res.type("text/xml").send(twiml.toString());
    }
  }

  // Handle "cancel all" for multiple bookings and index-based cancels
  if (pendingArr && pendingArr.length > 1 && mode === "cancel") {
    if (allRe.test(incomingMsg)) {
      for (const id of pendingArr) await cancelBooking(id);
      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(`🗑️ All ${pendingArr.length} bookings cancelled.`);
      return res.type("text/xml").send(twiml.toString());
    }
    const matches = incomingMsg.match(/\d+/g);
    if (matches && matches.length > 0) {
      const uniqueIndexes = [...new Set(matches.map(n => parseInt(n, 10)))].filter(idx => idx >= 1 && idx <= pendingArr.length);
      if (uniqueIndexes.length > 0) {
        for (const idx of uniqueIndexes) {
          await cancelBooking(pendingArr[idx - 1]);
        }
        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(`🗑️ Cancelled bookings: ${uniqueIndexes.join(", ")}.`);
        return res.type("text/xml").send(twiml.toString());
      }
    }
  }

  // Handle numeric selection for update/cancel
  const pending = cache.get(fromPhone);
  if (pending && pending.length > 1) {
    const idx = parseInt(incomingMsg.trim(), 10);
    if (!isNaN(idx) && idx >= 1 && idx <= pending.length) {
      const mode = cache.get(`${fromPhone}-mode`);
      if (mode === "update") {
        cache.set(fromPhone, [pending[idx - 1]]);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message(
          "Great! What would you like to update? You can say:\n" +
            "• 'Change time to 3pm'\n" +
            "• 'Move to tomorrow'\n" +
            "• 'Change service to pedicure'\n" +
            "• Or tell me the new time and service together"
        );
        return res.type("text/xml").send(twiml.toString());
      } else {
        await cancelBooking(pending[idx - 1]);
        cache.delete(fromPhone);
        cache.delete(`${fromPhone}-mode`);
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("🗑️ Cancelled! Hope to see you another time.");
        return res.type("text/xml").send(twiml.toString());
      }
    }
  }

  // Build the system prompt for OpenAI with the dynamic menu
  const menuText = await buildServiceMenuText();
  const chat = [
    {
      role: "system",
      content:
        "You are a friendly bilingual nail‑salon bot for WhatsApp.\n" +
        "When the user asks to book, ALWAYS call make_booking.\n" +
        "When the user wants to update a booking, call list_my_bookings first, then use update_my_booking.\n" +
        "For updates, you can handle:\n" +
        "- Time/date changes: extract new time from user message\n" +
        "- Service changes: match service names exactly as written below\n" +
        "- Combined changes: both time and service in one update\n" +
        "Return service_names exactly as written below.\n" +
        menuText +
        "\n" +
        "⚠️ When calling make_booking or update_my_booking, put the user's date words (e.g. 'tomorrow at 6 pm') in the text field. DO NOT convert to ISO.",
    },
    { role: "user", content: incomingMsg },
  ];

  // Talk to GPT
  // Talk to GPT
let bot;
try {
  bot = await talkToGPT(chat, fromPhone);
} catch (e) {
  console.error("GPT Error:", e);
  bot = { reply: "Oops, server error." };
}

// === 1. If GPT gives a simple reply (no function call) ===
if (bot.reply) {
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message(bot.reply);
  return res.type("text/xml").send(twiml.toString());
}

// === 2. If GPT wants your code to perform an action ===
if (bot.functionCall) {
  const { name, args } = bot.functionCall;

  // ---- A. List services ----
  if (name === "list_services") {
    const svcs = await listServices();
    const msg = svcs.map((s) => `• ${s.name_en} – ${s.price_jd} JD`).join("\n");
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`Here's what we offer:\n${msg}`);
    return res.type("text/xml").send(twiml.toString());
  }

  // ---- B. Make a booking ----
  if (name === "make_booking") {
    const startISO = parseDate(args.start_at_text);
    if (!startISO) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("Sorry, I couldn't understand that date. Try '25 June 3 pm'.");
      return res.type("text/xml").send(twiml.toString());
    }
    const id = await makeBooking({
      phone: fromPhone,
      names: args.service_names,
      startISO,
    });
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`✅ Booked! Your ID is BR-${id.slice(0, 6)}.`);
    return res.type("text/xml").send(twiml.toString());
  }

  // ---- C. List my bookings ----
  if (name === "list_my_bookings") {
    const rows = await upcomingBookings(fromPhone);

    if (rows.length === 0) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("😶‍🌫️ You have no upcoming bookings.");
      return res.type("text/xml").send(twiml.toString());
    }

    if (rows.length === 1) {
      cache.set(fromPhone, [rows[0].id]);
      const mode = cache.get(`${fromPhone}-mode`) || "cancel";
      const svcNames = rows[0].services.map((s) => s.name_en).join(", ");
      const when = DateTime.fromJSDate(new Date(rows[0].start_at))
        .setZone(TIME_ZONE)
        .toFormat("ccc d LLL HH:mm");
      const twiml = new twilio.twiml.MessagingResponse();
      if (mode === "update") {
        twiml.message(
          `I found your booking: ${svcNames} on ${when}.\n` +
            `What would you like to update? You can say:\n` +
            `• "Change time to 3pm"\n` +
            `• "Move to tomorrow"\n` +
            `• "Change service to pedicure"\n` +
            `• Or tell me the new time and service together`
        );
      } else {
        twiml.message(`I found one: ${svcNames} on ${when}. Cancel it? (yes / no)`);
      }
      return res.type("text/xml").send(twiml.toString());
    }

    // >1 booking
    cache.set(fromPhone, rows.map((r) => r.id));
    const mode = cache.get(`${fromPhone}-mode`) || "cancel";
    const action = mode === "update" ? "update" : "cancel";
    const listTxt = rows
      .map((r, i) => {
        const when = DateTime.fromJSDate(new Date(r.start_at))
          .setZone(TIME_ZONE)
          .toFormat("ccc d LLL HH:mm");
        const svcNames = r.services.map((s) => s.name_en).join(", ");
        return `${i + 1}️⃣ ${svcNames} – ${when}`;
      })
      .join("\n");
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(`Which booking do you want to ${action}? Reply with a number:\n${listTxt}`);
    return res.type("text/xml").send(twiml.toString());
  }

  // ---- D. Cancel by index ----
  if (name === "cancel_booking_by_index") {
    const arr = cache.get(fromPhone) || [];
    const id = arr[args.index - 1];
    if (!id) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("I couldn't find that booking number.");
      return res.type("text/xml").send(twiml.toString());
    }
    await cancelBooking(id);
    cache.delete(fromPhone);
    cache.delete(`${fromPhone}-mode`);
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message("🗑️ Cancelled! Hope to see you another time.");
    return res.type("text/xml").send(twiml.toString());
  }

  // ---- E. Update my booking ----
  if (name === "update_my_booking") {
    const arr = cache.get(fromPhone) || [];
    const idx = args.booking_index ?? 1;
    const id = arr[idx - 1];

    if (!id) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("I can't find that booking number.");
      return res.type("text/xml").send(twiml.toString());
    }

    // If no updates specified, ask what to change
    if (!args.new_start_text && !(args.new_service_names && args.new_service_names.length)) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(
        "What would you like to update? You can say:\n" +
          "• 'Change time to 3pm'\n" +
          "• 'Move to tomorrow'\n" +
          "• 'Change service to pedicure'\n" +
          "• Or tell me the new time and service together"
      );
      return res.type("text/xml").send(twiml.toString());
    }

    let newISO = null;
    if (args.new_start_text) {
      try {
        const existingBooking = await getBookingDetails(id);
        newISO = parseDatePreservingTime(
          args.new_start_text,
          existingBooking.start_at
        );
        if (!newISO) {
          const twiml = new twilio.twiml.MessagingResponse();
          twiml.message(
            "Sorry, I couldn't parse that date/time. Try something like 'tomorrow 3pm' or 'Monday 5pm'."
          );
          return res.type("text/xml").send(twiml.toString());
        }
      } catch (error) {
        const twiml = new twilio.twiml.MessagingResponse();
        twiml.message("Sorry, there was an error accessing your booking details.");
        return res.type("text/xml").send(twiml.toString());
      }
    }

    try {
      await updateBooking({
        id,
        newStartISO: newISO,
        newServices: args.new_service_names,
      });

      cache.delete(fromPhone);
      cache.delete(`${fromPhone}-mode`);

      let updateMsg = "🔄 Updated your booking!";
      if (newISO && args.new_service_names?.length) {
        const newTime = DateTime.fromISO(newISO)
          .setZone(TIME_ZONE)
          .toFormat("ccc d LLL HH:mm");
        updateMsg += ` New time: ${newTime}, New services: ${args.new_service_names.join(", ")}`;
      } else if (newISO) {
        const newTime = DateTime.fromISO(newISO)
          .setZone(TIME_ZONE)
          .toFormat("ccc d LLL HH:mm");
        updateMsg += ` New time: ${newTime}`;
      } else if (args.new_service_names?.length) {
        updateMsg += ` New services: ${args.new_service_names.join(", ")}`;
      }

      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message(updateMsg + "\n\nLet me know if there's anything else!");
      return res.type("text/xml").send(twiml.toString());
    } catch (error) {
      const twiml = new twilio.twiml.MessagingResponse();
      twiml.message("Sorry, there was an error updating your booking. Please try again.");
      return res.type("text/xml").send(twiml.toString());
    }
  }

  // ---- F. Ask what to update ----
  if (name === "ask_what_to_update") {
    const twiml = new twilio.twiml.MessagingResponse();
    twiml.message(
      "What would you like to update? You can say:\n" +
        "• 'Change time to 3pm'\n" +
        "• 'Move to tomorrow'\n" +
        "• 'Change service to pedicure'\n" +
        "• Or tell me the new time and service together"
    );
    return res.type("text/xml").send(twiml.toString());
  }

  // ---- If function not handled ----
  const twiml = new twilio.twiml.MessagingResponse();
  twiml.message("Sorry, I'm not sure how to help with that yet.");
  return res.type("text/xml").send(twiml.toString());
}

// === 3. If neither a reply nor a function call (very rare), fallback ===
const twiml = new twilio.twiml.MessagingResponse();
twiml.message("Sorry, I'm not sure how to help with that yet.");
return res.type("text/xml").send(twiml.toString());

}

module.exports = { handleIncomingMessage };
