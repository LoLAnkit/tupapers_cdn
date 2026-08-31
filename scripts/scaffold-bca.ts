#!/usr/bin/env node
/**
 * Scaffold the complete BCA folder structure under source/course/bca/.
 * Run: `npx tsx scripts/scaffold-bca.ts`
 */

import fs from "node:fs/promises";
import path from "node:path";

interface Semester {
  name: string;
  subjects: string[];
}

const BCA_SEMESTERS: Semester[] = [
  {
    name: "first-semester",
    subjects: [
      "computer-fundamental",
      "digital-logics",
      "programming-in-c",
      "fundamentals-of-it",
      "communication-skills",
      "mathematics-i",
    ],
  },
  {
    name: "second-semester",
    subjects: [
      "object-oriented-programming",
      "web-technologies",
      "database-management-systems",
      "computer-networks",
      "operating-systems",
      "mathematics-ii",
    ],
  },
  {
    name: "third-semester",
    subjects: [
      "data-structures",
      "algorithms",
      "system-software",
      "microprocessors",
      "software-engineering",
      "discrete-mathematics",
    ],
  },
  {
    name: "fourth-semester",
    subjects: [
      "advanced-algorithms",
      "database-design",
      "web-development",
      "computer-graphics",
      "artificial-intelligence",
      "formal-languages",
    ],
  },
  {
    name: "fifth-semester",
    subjects: [
      "compiler-design",
      "distributed-systems",
      "machine-learning",
      "network-security",
      "mobile-development",
      "numerical-methods",
    ],
  },
  {
    name: "sixth-semester",
    subjects: [
      "cloud-computing",
      "data-mining",
      "cryptography",
      "information-retrieval",
      "software-testing",
      "parallel-computing",
    ],
  },
  {
    name: "seventh-semester",
    subjects: [
      "advanced-web-technologies",
      "big-data",
      "advanced-ai",
      "blockchain",
      "iot-systems",
      "advanced-databases",
    ],
  },
  {
    name: "eighth-semester",
    subjects: [
      "capstone-project",
      "emerging-technologies",
      "business-intelligence",
      "quantum-computing",
      "advanced-security",
      "industry-practices",
    ],
  },
];

const CATEGORIES = ["diagram"]; // can add "figure", "table" later

async function scaffold(): Promise<void> {
  const rootDir = path.resolve("source", "course", "bca");

  let created = 0;
  for (const sem of BCA_SEMESTERS) {
    for (const subject of sem.subjects) {
      for (const category of CATEGORIES) {
        const dir = path.join(rootDir, sem.name, subject, "notes", category);
        try {
          await fs.mkdir(dir, { recursive: true });
          created += 1;
          console.log(`✓ ${path.relative(".", dir)}`);
        } catch (err) {
          console.error(`✗ Failed to create ${dir}:`, err);
        }
      }
    }
  }

  console.log(
    `\n✓ Scaffolded ${created} folder(s). Ready for images:\n` +
      `  source/course/bca/<semester>/<subject>/notes/<category>/\n\n` +
      `Next: Drop images and run: npm run sync`,
  );
}

scaffold().catch((err: Error) => {
  console.error("✗ Scaffolding failed:", err.message);
  process.exit(1);
});
