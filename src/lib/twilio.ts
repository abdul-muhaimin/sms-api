import twilio from "twilio";

export const twilioClient = twilio(
  process.env.TWILIO_ACCOUNT_SID!,
  process.env.TWILIO_AUTH_TOKEN!,
);

export const MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID!;
