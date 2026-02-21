import { Request } from "express";
import type { Tenant } from "@prisma/client";

export interface AuthenticatedRequest extends Request {
  tenant: Tenant;
}
