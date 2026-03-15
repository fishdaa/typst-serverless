// Run before all tests. Sets AWS env so SDK clients don't error in integration tests.
process.env.AWS_REGION ??= "us-east-1";
process.env.AWS_ACCESS_KEY_ID ??= "test";
process.env.AWS_SECRET_ACCESS_KEY ??= "test";

// Use devbox typst (in PATH) by default; override with TYPST_PATH if set.
process.env.TYPST_PATH ??= "typst";
