/**
 * Parse multipart/form-data body into a single-document compile payload.
 * Used for POST /compile with Content-Type: multipart/form-data.
 */
import { Readable } from "node:stream";
import { validateExtraTypName } from "@/core/validate.js";
// eslint-disable-next-line @typescript-eslint/no-require-imports
const Busboy = require("busboy");

export interface MultipartDocument {
    mainTyp: string;
    main?: string;
    /** Optional extra .typ sources for #include / modules (path relative to workDir) */
    extraTyps?: Array<{ name: string; base64: string }>;
    documentId?: string;
    storeToS3?: boolean;
    outputFormat?: string;
    pdfStandard?: string;
    fonts?: Array<{ name: string; base64: string }>;
    assets?: Array<{ name: string; base64: string }>;
    data?: string;
    dataFile?: string;
    webhook?: { url: string };
    [key: string]: unknown;
}

/**
 * Parse multipart/form-data buffer into a single document for compile.
 * Part names: main | mainTyp | file = .typ source (required); extraTyp | extraTyps = additional .typ files;
 * asset(s) = images; font(s) = fonts; data = template data.
 * Fields: documentId, storeToS3, outputFormat, main (filename), dataFile, webhook (URL).
 */
export function parseMultipartCompileBody(
    bodyBuffer: Buffer,
    contentType: string
): Promise<MultipartDocument> {
    return new Promise((resolve, reject) => {
        const fields: Record<string, string> = {};
        let mainTyp: string | null = null;
        const extraTyps: Array<{ name: string; base64: string }> = [];
        const assets: Array<{ name: string; base64: string }> = [];
        const fonts: Array<{ name: string; base64: string }> = [];
        let dataBase64: string | null = null;
        let dataFileName: string | null = null;

        const busboy = Busboy({
            headers: { "content-type": contentType },
            limits: { fileSize: 10 * 1024 * 1024 },
        });

        busboy.on("field", (name: string, value: string) => {
            fields[name] = value;
        });

        busboy.on("file", (fieldname: string, stream: NodeJS.ReadableStream, info: { filename?: string }) => {
            const chunks: Buffer[] = [];
            stream.on("data", (chunk: Buffer) => chunks.push(chunk));
            stream.on("end", () => {
                const buf = Buffer.concat(chunks);
                const base64 = buf.toString("base64");
                const filename = info.filename || fieldname || "file";

                if (fieldname === "main" || fieldname === "mainTyp" || fieldname === "file") {
                    if (mainTyp != null) {
                        reject(new Error("Only one main .typ file allowed"));
                        return;
                    }
                    mainTyp = base64;
                    return;
                }
                if (fieldname === "extraTyp" || fieldname === "extraTyps") {
                    // busboy strips any directory component from filename (same as browsers do),
                    // so multipart extraTyp names are always flat — nested #include() paths (e.g.
                    // "lib/module.typ") require the JSON API's extraTyps[].name field instead.
                    const nameCheck = validateExtraTypName(filename);
                    if (!nameCheck.valid) {
                        reject(new Error(`Extra .typ part: ${nameCheck.error}`));
                        return;
                    }
                    extraTyps.push({ name: filename, base64 });
                    return;
                }
                if (fieldname === "asset" || fieldname === "assets") {
                    assets.push({ name: filename, base64 });
                    return;
                }
                if (fieldname === "font" || fieldname === "fonts") {
                    fonts.push({ name: filename, base64 });
                    return;
                }
                if (fieldname === "data") {
                    dataBase64 = base64;
                    dataFileName = info.filename || "data.json";
                }
            });
            stream.on("error", (err: Error) => reject(err));
        });

        busboy.on("finish", () => {
            if (mainTyp == null) {
                reject(new Error("Missing required part: main, mainTyp, or file (.typ source)"));
                return;
            }
            const doc: MultipartDocument = {
                mainTyp,
                main: fields.main || "main.typ",
                ...(extraTyps.length > 0 && { extraTyps }),
                ...(fields.documentId && { documentId: fields.documentId }),
                ...(fields.storeToS3 === "true" || fields.storeToS3 === "1" ? { storeToS3: true } : {}),
                ...(fields.outputFormat && { outputFormat: fields.outputFormat }),
                ...(fields.pdfStandard && { pdfStandard: fields.pdfStandard }),
                ...(assets.length > 0 && { assets }),
                ...(fonts.length > 0 && { fonts }),
                ...(dataBase64 && { data: dataBase64, dataFile: dataFileName || "data.json" }),
                ...(fields.webhook && { webhook: { url: fields.webhook } }),
            };
            resolve(doc);
        });

        busboy.on("error", (err: Error) => reject(err));

        const readable = Readable.from(bodyBuffer);
        readable.pipe(busboy);
    });
}

/**
 * Returns true if contentType is multipart/form-data.
 */
export function isMultipartFormData(contentType: string | undefined): boolean {
    if (!contentType || typeof contentType !== "string") return false;
    return contentType.toLowerCase().trim().startsWith("multipart/form-data");
}
