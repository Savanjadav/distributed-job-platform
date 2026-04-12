// This file runs before each test file.
// You can add DB cleanup hooks later if needed.
beforeAll(() => {
  process.env.JWT_SECRET = "supersecretkey";
});
