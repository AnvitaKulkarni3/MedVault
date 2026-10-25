import "dotenv/config";
import express from "express";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import multer from "multer";
import helmet from "helmet";
import rateLimit from "express-rate-limit";
import cookieParser from "cookie-parser";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createWorker } from "tesseract.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const app = express();
const port = Number(process.env.PORT || 4000);
const jwtSecret = process.env.JWT_SECRET;
const privateDir = path.join(__dirname, "private_uploads");
const categories = new Set(["records", "medications", "appointments", "expenses", "diet", "notes", "groceries", "dose-logs"]);
const validRoles = ["patient", "admin"];

if (!jwtSecret || jwtSecret.length < 32) {
  throw new Error("JWT_SECRET must be set to a random value of at least 32 characters.");
}

await mkdir(privateDir, { recursive: true });

const userSchema = new mongoose.Schema({
  displayName: { type: String, required: true, trim: true, maxlength: 80 },
  email: { type: String, required: true, unique: true, lowercase: true, trim: true },
  passwordHash: { type: String, required: true, select: false },
  role: { type: String, enum: validRoles, default: "patient" },
  status: { type: String, enum: ["active", "disabled"], default: "active" },
  lastLoginAt: Date
}, { timestamps: true });

const entrySchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  category: { type: String, required: true, enum: [...categories], index: true },
  data: { type: mongoose.Schema.Types.Mixed, required: true }
}, { timestamps: true, minimize: false });

const prescriptionSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true, index: true },
  status: { type: String, enum: ["review_required", "processing", "confirmed", "failed"], default: "review_required" },
  storageKey: { type: String, required: true },
  mimeType: { type: String, required: true },
  candidateMedicines: [{ name: String, strength: String, instructions: String, frequency: String, confidence: Number, userConfirmed: Boolean }],
  safeErrorCode: String,
  confirmedAt: Date
}, { timestamps: true });

const auditSchema = new mongoose.Schema({
  actorId: { type: mongoose.Schema.Types.ObjectId, ref: "User", required: true },
  action: { type: String, required: true },
  targetUserId: { type: mongoose.Schema.Types.ObjectId, ref: "User" },
  createdAt: { type: Date, default: Date.now }
});

const User = mongoose.model("User", userSchema);
const Entry = mongoose.model("Entry", entrySchema);
const Prescription = mongoose.model("Prescription", prescriptionSchema);
const Audit = mongoose.model("Audit", auditSchema);

app.use(helmet({ crossOriginResourcePolicy: { policy: "same-site" } }));
app.use(cookieParser());
app.use(express.json({ limit: "1mb" }));
app.use((req, res, next) => {
  const origin = process.env.CLIENT_ORIGIN || "http://localhost:5173";
  if (req.headers.origin && req.headers.origin !== origin) return res.status(403).json({ error: "This request origin is not allowed." });
  res.setHeader("Access-Control-Allow-Origin", origin);
  res.setHeader("Access-Control-Allow-Credentials", "true");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,PATCH,DELETE,OPTIONS");
  if (req.method === "OPTIONS") return res.sendStatus(204);
  next();
});

function safeUser(user) {
  return { id: user._id, displayName: user.displayName, email: user.email, role: user.role, status: user.status };
}

function issueSession(user, res) {
  const token = jwt.sign({ sub: user._id.toString() }, jwtSecret, { expiresIn: "8h" });
  res.cookie("medvault_session", token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 8 * 60 * 60 * 1000,
    path: "/"
  });
}

async function authenticate(req, res, next) {
  try {
    const token = req.cookies?.medvault_session || req.headers.authorization?.replace(/^Bearer\s+/i, "");
    if (!token) return res.status(401).json({ error: "Please sign in to continue." });
    const payload = jwt.verify(token, jwtSecret);
    const user = await User.findById(payload.sub);
    if (!user || user.status !== "active") return res.status(401).json({ error: "This account cannot sign in." });
    req.user = user;
    next();
  } catch {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

function requireAdmin(req, res, next) {
  if (req.user?.role !== "admin") return res.status(403).json({ error: "Administrator access is required." });
  next();
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

function cleanEntryData(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const data = {};
  for (const [key, raw] of Object.entries(value)) {
    if (!/^[a-zA-Z][a-zA-Z0-9_]{0,39}$/.test(key)) continue;
    if (["__proto__", "constructor", "prototype"].includes(key)) continue;
    if (typeof raw === "string") data[key] = raw.trim().slice(0, 2000);
    else if (typeof raw === "number" && Number.isFinite(raw)) data[key] = raw;
    else if (typeof raw === "boolean") data[key] = raw;
    else if (raw === null) data[key] = null;
    else if (Array.isArray(raw)) data[key] = raw.slice(0, 100).map((item) => typeof item === "string" ? item.slice(0, 200) : item);
    else if (typeof raw === "object") data[key] = JSON.parse(JSON.stringify(raw).slice(0, 4000));
  }
  return Object.keys(data).length ? data : null;
}

app.get("/api/health", (_req, res) => res.json({ status: "ok" }));

const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });
app.post("/api/auth/register", authLimiter, asyncRoute(async (req, res) => {
  const displayName = String(req.body.displayName || "").trim();
  const email = String(req.body.email || "").trim().toLowerCase();
  const password = String(req.body.password || "");
  if (displayName.length < 2 || displayName.length > 80 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || password.length < 10 || password.length > 128) {
    return res.status(400).json({ error: "Enter a name, valid email, and password of 10–128 characters." });
  }
  if (await User.exists({ email })) return res.status(409).json({ error: "An account with this email already exists." });
  const user = await User.create({ displayName, email, passwordHash: await bcrypt.hash(password, 12), role: "patient" });
  issueSession(user, res);
  res.status(201).json({ user: safeUser(user) });
}));

app.post("/api/auth/login", authLimiter, asyncRoute(async (req, res) => {
  const email = String(req.body.email || "").trim().toLowerCase();
  const user = await User.findOne({ email }).select("+passwordHash");
  if (!user || !(await bcrypt.compare(String(req.body.password || ""), user.passwordHash))) {
    return res.status(401).json({ error: "Email or password is incorrect." });
  }
  if (user.status !== "active") return res.status(403).json({ error: "This account is disabled. Please contact support." });
  user.lastLoginAt = new Date();
  await user.save();
  issueSession(user, res);
  res.json({ user: safeUser(user) });
}));

app.post("/api/auth/logout", (_req, res) => {
  res.clearCookie("medvault_session", { httpOnly: true, sameSite: "strict", secure: process.env.NODE_ENV === "production", path: "/" });
  res.sendStatus(204);
});

app.get("/api/auth/me", authenticate, (req, res) => res.json({ user: safeUser(req.user) }));

app.get("/api/entries/:category", authenticate, asyncRoute(async (req, res) => {
  if (!categories.has(req.params.category)) return res.status(404).json({ error: "Unknown section." });
  const entries = await Entry.find({ userId: req.user._id, category: req.params.category }).sort({ createdAt: -1 }).lean();
  res.json({ entries });
}));

app.post("/api/entries/:category", authenticate, asyncRoute(async (req, res) => {
  if (!categories.has(req.params.category)) return res.status(404).json({ error: "Unknown section." });
  const data = cleanEntryData(req.body.data);
  if (!data || !String(data.title || "").trim()) return res.status(400).json({ error: "A title is required." });
  if (req.params.category === "expenses" && (!Number.isFinite(Number(data.amount)) || Number(data.amount) < 0)) {
    return res.status(400).json({ error: "Enter a valid non-negative expense amount." });
  }
  const entry = await Entry.create({ userId: req.user._id, category: req.params.category, data });
  res.status(201).json({ entry });
}));

app.patch("/api/entries/:category/:id", authenticate, asyncRoute(async (req, res) => {
  if (!categories.has(req.params.category)) return res.status(404).json({ error: "Unknown section." });
  const changes = cleanEntryData(req.body.data);
  if (!changes) return res.status(400).json({ error: "No valid changes were provided." });
  const entry = await Entry.findOne({ _id: req.params.id, userId: req.user._id, category: req.params.category });
  if (!entry) return res.status(404).json({ error: "Entry not found." });
  entry.data = { ...entry.data, ...changes };
  await entry.save();
  res.json({ entry });
}));

app.delete("/api/entries/:category/:id", authenticate, asyncRoute(async (req, res) => {
  if (!categories.has(req.params.category)) return res.status(404).json({ error: "Unknown section." });
  const result = await Entry.deleteOne({ _id: req.params.id, userId: req.user._id, category: req.params.category });
  if (!result.deletedCount) return res.status(404).json({ error: "Entry not found." });
  res.sendStatus(204);
}));

app.get("/api/dashboard", authenticate, asyncRoute(async (req, res) => {
  const [entries, prescriptions] = await Promise.all([
    Entry.find({ userId: req.user._id }).sort({ createdAt: -1 }).limit(100).lean(),
    Prescription.find({ userId: req.user._id }).sort({ createdAt: -1 }).select("-storageKey -mimeType").lean()
  ]);
  const grouped = Object.fromEntries([...categories].map((category) => [category, entries.filter((entry) => entry.category === category)]));
  res.json({ entries: grouped, prescriptions });
}));

const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 8 * 1024 * 1024, files: 1 } });
const ocrLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false });
app.post("/api/prescriptions/scan", authenticate, ocrLimiter, upload.single("prescription"), asyncRoute(async (req, res) => {
  if (!req.file) return res.status(400).json({ error: "Choose a JPG or PNG prescription image." });
  const bytes = req.file.buffer;
  let mimeType;
  if (bytes.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) mimeType = "image/jpeg";
  else if (bytes.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) mimeType = "image/png";
  else return res.status(400).json({ error: "The file is not a supported JPG or PNG image." });

  const storageKey = `${randomUUID()}.${mimeType === "image/png" ? "png" : "jpg"}`;
  const filePath = path.join(privateDir, storageKey);
  await writeFile(filePath, bytes, { flag: "wx", mode: 0o600 });
  let prescription;
  try {
    prescription = await Prescription.create({ userId: req.user._id, storageKey, mimeType, status: "processing" });
  } catch (error) {
    await unlink(filePath);
    throw error;
  }
  let text;
  try {
    const worker = await createWorker("eng");
    try {
      const result = await worker.recognize(bytes);
      text = result.data.text || "";
    } finally {
      await worker.terminate();
    }
  } catch {
    await Prescription.updateOne({ _id: prescription._id }, { $set: { status: "failed", safeErrorCode: "OCR_PROCESSING_FAILED" } });
    try {
      await unlink(filePath);
    } catch (cleanupError) {
      console.error("Private OCR upload cleanup failed:", cleanupError?.code || "UNKNOWN");
    }
    return res.status(503).json({ error: "The image could not be read. Try a clearer image or enter the information manually." });
  }
  const lines = text.split(/\r?\n/).map((line) => line.trim()).filter((line) => line.length > 2).slice(0, 8);
  prescription.candidateMedicines = lines.length
    ? lines.map((line) => ({ name: line.slice(0, 120), strength: "", instructions: "", frequency: "", confidence: 0.3, userConfirmed: false }))
    : [{ name: "", strength: "", instructions: "", frequency: "", confidence: 0, userConfirmed: false }];
  prescription.status = "review_required";
  await prescription.save();
  res.status(201).json({ prescription: { ...prescription.toObject(), storageKey: undefined, mimeType: undefined } });
}));

app.get("/api/prescriptions", authenticate, asyncRoute(async (req, res) => {
  const prescriptions = await Prescription.find({ userId: req.user._id }).select("-storageKey -mimeType").sort({ createdAt: -1 }).lean();
  res.json({ prescriptions });
}));

app.get("/api/prescriptions/:id/file", authenticate, asyncRoute(async (req, res) => {
  const prescription = await Prescription.findOne({ _id: req.params.id, userId: req.user._id }).select("storageKey mimeType");
  if (!prescription) return res.status(404).json({ error: "Prescription not found." });
  const file = await readFile(path.join(privateDir, path.basename(prescription.storageKey)));
  res.setHeader("Content-Type", prescription.mimeType);
  res.setHeader("Cache-Control", "private, no-store");
  res.send(file);
}));

app.post("/api/prescriptions/:id/confirm", authenticate, asyncRoute(async (req, res) => {
  const candidates = req.body.candidateMedicines;
  if (!Array.isArray(candidates) || !candidates.length || candidates.length > 20 || candidates.some((item) => !item.userConfirmed || !String(item.name || "").trim())) {
    return res.status(400).json({ error: "Review every medicine name and explicitly confirm each one before saving." });
  }
  const prescription = await Prescription.findOneAndUpdate(
    { _id: req.params.id, userId: req.user._id, status: "review_required" },
    { $set: { status: "processing" } },
    { new: true }
  );
  if (!prescription) {
    const existing = await Prescription.findOne({ _id: req.params.id, userId: req.user._id }).select("status");
    if (!existing) return res.status(404).json({ error: "Prescription not found." });
    return res.status(409).json({ error: existing.status === "confirmed" ? "This prescription was already confirmed." : "This prescription is already being processed." });
  }
  let medications = [];
  try {
    medications = await Promise.all(candidates.map((item) => Entry.create({
      userId: req.user._id,
      category: "medications",
      data: {
        title: String(item.name).trim().slice(0, 120),
        strength: String(item.strength || "").trim().slice(0, 120),
        instructions: String(item.instructions || "").trim().slice(0, 500),
        frequency: String(item.frequency || "").trim().slice(0, 120),
        stock: 0,
        reminderEnabled: false,
        source: "user-confirmed prescription"
      }
    })));
    prescription.candidateMedicines = candidates.map((item) => ({
      name: String(item.name).trim().slice(0, 120),
      strength: String(item.strength || "").trim().slice(0, 120),
      instructions: String(item.instructions || "").trim().slice(0, 500),
      frequency: String(item.frequency || "").trim().slice(0, 120),
      confidence: Math.max(0, Math.min(1, Number(item.confidence) || 0)),
      userConfirmed: true
    }));
    prescription.status = "confirmed";
    prescription.confirmedAt = new Date();
    await prescription.save();
  } catch (error) {
    await Entry.deleteMany({ _id: { $in: medications.map((item) => item._id) }, userId: req.user._id });
    await Prescription.updateOne({ _id: prescription._id, status: "processing" }, { $set: { status: "review_required" } });
    throw error;
  }
  res.json({ prescription: { ...prescription.toObject(), storageKey: undefined, mimeType: undefined }, medications });
}));

app.get("/api/admin/overview", authenticate, requireAdmin, asyncRoute(async (_req, res) => {
  const [totalAccounts, activeAccounts, disabledAccounts, registrations, auditEvents] = await Promise.all([
    User.countDocuments(),
    User.countDocuments({ status: "active" }),
    User.countDocuments({ status: "disabled" }),
    User.countDocuments({ createdAt: { $gte: new Date(Date.now() - 30 * 86400000) } }),
    Audit.countDocuments()
  ]);
  const [pendingOcr, failedOcr, totalOcr] = await Promise.all([
    Prescription.countDocuments({ status: { $in: ["processing", "review_required"] } }),
    Prescription.countDocuments({ status: "failed" }),
    Prescription.countDocuments()
  ]);
  res.json({ totalAccounts, activeAccounts, disabledAccounts, registrationsLast30Days: registrations, auditEvents, ocr: { pending: pendingOcr, failed: failedOcr, total: totalOcr } });
}));

app.get("/api/admin/users", authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const search = String(req.query.search || "").trim().slice(0, 100);
  const filter = search ? { $or: [{ displayName: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }, { email: new RegExp(search.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "i") }] } : {};
  const users = await User.find(filter).select("displayName email role status createdAt lastLoginAt").sort({ createdAt: -1 }).limit(100).lean();
  res.json({ users });
}));

app.patch("/api/admin/users/:id/status", authenticate, requireAdmin, asyncRoute(async (req, res) => {
  const status = req.body.status;
  if (!["active", "disabled"].includes(status)) return res.status(400).json({ error: "Status must be active or disabled." });
  if (String(req.user._id) === req.params.id && status === "disabled") return res.status(400).json({ error: "You cannot disable your own administrator account." });
  const user = await User.findByIdAndUpdate(req.params.id, { status }, { new: true }).select("displayName email role status createdAt lastLoginAt");
  if (!user) return res.status(404).json({ error: "Account not found." });
  await Audit.create({ actorId: req.user._id, action: `account_${status}`, targetUserId: user._id });
  res.json({ user });
}));

app.get("/api/admin/audit-logs", authenticate, requireAdmin, asyncRoute(async (_req, res) => {
  const logs = await Audit.find().sort({ createdAt: -1 }).limit(100).populate("actorId", "displayName").populate("targetUserId", "displayName").lean();
  res.json({ logs: logs.map((log) => ({ action: log.action, createdAt: log.createdAt, actor: log.actorId?.displayName || "Unknown", target: log.targetUserId?.displayName || "—" })) });
}));

app.use("/api", (_req, res) => res.status(404).json({ error: "API route not found." }));
app.use((error, _req, res, _next) => {
  if (error instanceof multer.MulterError) {
    return res.status(error.code === "LIMIT_FILE_SIZE" ? 413 : 400).json({ error: error.code === "LIMIT_FILE_SIZE" ? "Image must be 8 MB or smaller." : "Upload could not be processed." });
  }
  if (error?.name === "ValidationError") return res.status(400).json({ error: "Some provided values are invalid." });
  if (error?.name === "CastError") return res.status(400).json({ error: "Invalid identifier." });
  console.error("Request failed:", error?.message || "Unknown error");
  res.status(500).json({ error: "The request could not be completed. Please try again." });
});

const clientDist = path.resolve(__dirname, "../dist");
if (process.env.NODE_ENV === "production") {
  app.use(express.static(clientDist));
  app.get("*", (_req, res) => res.sendFile(path.join(clientDist, "index.html")));
}

async function bootstrapAdmin() {
  const email = process.env.ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.ADMIN_PASSWORD;
  if (!email && !password) return;
  if (!email || !password || password.length < 12) throw new Error("Set both ADMIN_EMAIL and ADMIN_PASSWORD (at least 12 characters) to bootstrap an administrator.");
  if (!(await User.exists({ email }))) {
    await User.create({
      displayName: "MedVault Administrator",
      email,
      passwordHash: await bcrypt.hash(password, 12),
      role: "admin"
    });
    console.info("Initial administrator account created from environment configuration.");
  }
}

await mongoose.connect(process.env.MONGODB_URI || "mongodb://127.0.0.1:27017/medvault");
await bootstrapAdmin();
app.listen(port, () => console.info(`MedVault API listening on http://localhost:${port}`));
