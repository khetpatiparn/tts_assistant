-- CreateTable
CREATE TABLE "ScannerLink" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT 'singleton',
    "token" TEXT NOT NULL,
    "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
);
