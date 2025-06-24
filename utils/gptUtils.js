// utils/gptUtils.js

const { OpenAI } = require("openai");

// Define your OpenAI function schemas
const functionSchema = [
  {
    name: "list_services",
    description: "return all active nail services",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "make_booking",
    description: "create a booking (user words in start_at_text)",
    parameters: {
      type: "object",
      properties: {
        service_names: { type: "array", items: { type: "string" } },
        start_at_text: { type: "string" },
      },
      required: ["service_names", "start_at_text"],
    },
  },
  {
    name: "list_my_bookings",
    description: "return user upcoming bookings",
    parameters: { type: "object", properties: {} },
  },
  {
    name: "cancel_booking_by_index",
    description: "cancel N‑th booking",
    parameters: {
      type: "object",
      properties: {
        index: { type: "integer", description: "1‑based" },
      },
      required: ["index"],
    },
  },
  {
    name: "update_my_booking",
    description:
      "modify an existing booking - can update time, date, services, or any combination",
    parameters: {
      type: "object",
      properties: {
        booking_index: {
          type: "integer",
          description: "1‑based index of the booking to update",
        },
        new_start_text: {
          type: "string",
          description:
            "New date/time in natural language (e.g., 'tomorrow 3pm', 'Monday 5pm'). Leave null if not changing.",
        },
        new_service_names: {
          type: "array",
          items: { type: "string" },
          description:
            "New service names exactly as they appear in the service menu. Leave null if not changing services.",
        },
      },
      required: ["booking_index"],
    },
  },
  {
    name: "ask_what_to_update",
    description: "clarify what specific aspect of the booking to change",
    parameters: { type: "object", properties: {} },
  },
];

// OpenAI setup
const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper to talk to GPT and handle function-calling logic
async function talkToGPT(history, phone) {
  const res = await openai.chat.completions.create({
    model: "gpt-4o-mini",
    temperature: 0,
    messages: history,
    functions: functionSchema,
  });

  const choice = res.choices[0];

  // If plain-text answer, just return it
  if (choice.finish_reason !== "function_call") {
    return { reply: choice.message.content || "I'm not sure I understood." };
  }

  // Otherwise, it's a function call (handled elsewhere)
  const { name, arguments: raw } = choice.message.function_call;
  const args = raw ? JSON.parse(raw) : {};

  // Just pass the function call data; your botService will act on it
  return { functionCall: { name, args } };
}

module.exports = {
  functionSchema,
  talkToGPT,
};
