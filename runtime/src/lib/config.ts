import { z } from 'zod';

// Validate RESEND_FROM_EMAIL if provided
const fromEmail = process.env.RESEND_FROM_EMAIL;
if (fromEmail !== undefined && fromEmail !== '') {
  const result = z.string().email().safeParse(fromEmail);
  if (!result.success) {
    console.warn(`[Config] Invalid RESEND_FROM_EMAIL: "${fromEmail}" — using default`);
  }
}

export const config = {
  LINEAR_API_KEY: process.env.LINEAR_API_KEY || undefined,
  RESEND_API_KEY: process.env.RESEND_API_KEY || undefined,
  RESEND_FROM_EMAIL: (fromEmail && z.string().email().safeParse(fromEmail).success) ? fromEmail : 'triage@agenticengineering.lat',
};

export const LINEAR_CONSTANTS = {
  TEAM_ID: '645a639b-39e2-4abe-8ded-3346d2f79f9f',

  STATES: {
    TRIAGE: '582398ee-98b0-406b-b2f6-8bca23c1b607',
    BACKLOG: 'b4bc738c-c3a5-4355-a3fe-72d183ec21ee',
    TODO: '3b9b9b60-e6eb-4914-9e1d-f3c8ce1eba0c',
    IN_PROGRESS: '889e861e-3bd6-4f98-888d-3e976ee583e9',
    IN_REVIEW: '1b1e7e58-03e7-4bb9-be10-669444e7b377',
    DONE: '0b0ac11a-a9c1-46d9-a10a-dabb935b53af',
    DUPLICATE: '5a98d91e-773d-4301-a966-1398ae99b906',
    CANCELED: '19d1f436-5f3e-420b-a197-f31cfd2636f6',
  },

  SEVERITY_LABELS: {
    CRITICAL: '60a50b72-d1c2-4823-9111-f85f345138d7',
    HIGH: '500cd0cb-2501-43e9-ad91-fba598d40a54',
    MEDIUM: 'bca8aa2f-e32b-49a3-9bc4-18a33c4c832e',
    LOW: '28fe88b4-88fa-4cd5-a35d-dcec4e4df82d',
  },

  CATEGORY_LABELS: {
    BUG: 'f599da19-8743-4569-a110-a666dc588811',
    FEATURE: '909d247a-40f4-48d5-a104-c238cc2ab45b',
    IMPROVEMENT: '50756390-d166-4b79-a740-ceefb203751f',
  },

  MEMBERS: {
    FERNANDO: '90b16a9c-3f47-49fc-8d98-abf3aa6ecb13',
    KOKI: 'c3f725e4-aa51-45d3-af43-d29a87077226',
    CHENKO: '7d177d95-4df7-4dff-a3df-710f49eba663',
    LALO: 'b17c4757-ceef-4a13-b3c4-fc2ae09d50de',
  },
} as const;
