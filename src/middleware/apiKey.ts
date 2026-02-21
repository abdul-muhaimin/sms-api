import { Request, Response, NextFunction } from "express";
import { prisma } from "../lib/prisma";
import { AuthenticatedRequest } from "../types";

export async function apiKeyAuth(
  req: Request,
  res: Response,
  next: NextFunction,
) {
  const authHeader = req.headers.authorization;

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    return res.status(401).json({ error: "Missing API key" });
  }

  const apiKey = authHeader.split(" ")[1];

  const tenant = await prisma.tenant.findUnique({
    where: { apiKey },
  });

  if (!tenant || !tenant.isActive) {
    return res.status(401).json({ error: "Invalid or inactive API key" });
  }

  (req as AuthenticatedRequest).tenant = tenant;
  next();
}
