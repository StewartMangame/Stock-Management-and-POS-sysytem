/**
 * Zod validation schemas — single source of truth for all input shapes.
 * Used in server actions, API routes, and form validation (via @hookform/resolvers/zod).
 */

import { z } from 'zod';
import { SETTING_KEYS } from '@/server/db/schema';

// ── Auth ──────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  email: z.string().email('Enter a valid email address').toLowerCase(),
  password: z.string().min(1, 'Password is required'),
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Current password is required'),
    newPassword: z
      .string()
      .min(8, 'Password must be at least 8 characters')
      .regex(/[A-Z]/, 'Must contain an uppercase letter')
      .regex(/[0-9]/, 'Must contain a number'),
    confirmPassword: z.string(),
  })
  .refine((d) => d.newPassword === d.confirmPassword, {
    message: 'Passwords do not match',
    path: ['confirmPassword'],
  });

// ── Users ─────────────────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100),
  email: z.string().email('Enter a valid email address').toLowerCase(),
  password: z
    .string()
    .min(8, 'Password must be at least 8 characters')
    .regex(/[A-Z]/, 'Must contain an uppercase letter')
    .regex(/[0-9]/, 'Must contain a number'),
  roleId: z.string().uuid('Select a role'),
  defaultLocationId: z.string().uuid().optional().nullable(),
});

export const updateUserSchema = z.object({
  name: z.string().min(2).max(100),
  roleId: z.string().uuid('Select a role'),
  defaultLocationId: z.string().uuid().optional().nullable(),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;

// ── Settings ──────────────────────────────────────────────────────────────────

export const updateSettingSchema = z.object({
  key: z.enum(SETTING_KEYS),
  value: z.unknown(),
});

export type UpdateSettingInput = z.infer<typeof updateSettingSchema>;
