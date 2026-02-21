"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.MESSAGING_SERVICE_SID = exports.twilioClient = void 0;
const twilio_1 = __importDefault(require("twilio"));
exports.twilioClient = (0, twilio_1.default)(process.env.TWILIO_ACCOUNT_SID, process.env.TWILIO_AUTH_TOKEN);
exports.MESSAGING_SERVICE_SID = process.env.TWILIO_MESSAGING_SERVICE_SID;
