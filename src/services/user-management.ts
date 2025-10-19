import { randomUUID } from 'crypto';

import { ensureDefaultQuotas } from '../repositories/quotas';
import {
  createUser,
  deleteUser,
  getUserByEmail,
  getUserById,
  listUsers,
  type CreateUserInput,
  updateUser,
  type ListUsersInput,
  type ListUsersOutput
} from '../repositories/users';

import {
  createCognitoUser,
  deleteCognitoUser,
  setCognitoUserRole,
  updateCognitoUserAttributes
} from './cognito';

export interface AdminCreateUserInput {
  email: string;
  displayName: string;
  role: CreateUserInput['role'];
  userId?: string;
  isActive?: boolean;
  temporaryPassword?: string;
  firstName?: string;
  lastName?: string;
  avatarKey?: string;
}

export const createUserWithDefaults = async (input: AdminCreateUserInput) => {
  const userId = input.userId ?? randomUUID();

  const [existingById, existingByEmail] = await Promise.all([
    getUserById(userId),
    getUserByEmail(input.email)
  ]);

  if (existingById) {
    throw new Error(`User with id ${userId} already exists`);
  }

  if (existingByEmail) {
    throw new Error(`User with email ${input.email} already exists`);
  }

  const cognito = await createCognitoUser({
    email: input.email,
    displayName: input.displayName,
    userId,
    role: input.role,
    temporaryPassword: input.temporaryPassword,
    firstName: input.firstName,
    lastName: input.lastName
  });

  const user = await createUser({
    userId,
    email: input.email,
    displayName: input.displayName,
    role: input.role,
    cognitoSub: cognito.sub,
    isActive: input.isActive ?? true,
    firstName: input.firstName,
    lastName: input.lastName,
    avatarKey: input.avatarKey
  });

  await ensureDefaultQuotas(userId);

  return user;
};

export const listUsersWithOptions = async (
  options: ListUsersInput
): Promise<ListUsersOutput> => listUsers(options);

export interface AdminUpdateUserInput {
  userId: string;
  displayName?: string;
  role?: CreateUserInput['role'];
  isActive?: boolean;
  firstName?: string;
  lastName?: string;
  avatarKey?: string | null;
}

export const updateUserProfile = async (input: AdminUpdateUserInput) => {
  const existing = await getUserById(input.userId);
  if (!existing) {
    throw new Error(`User ${input.userId} not found`);
  }

  const updated = await updateUser({
    userId: input.userId,
    displayName: input.displayName,
    role: input.role,
    isActive: input.isActive,
    firstName: input.firstName,
    lastName: input.lastName,
    avatarKey: input.avatarKey ?? undefined
  });

  if (!updated) {
    throw new Error('Failed to update user profile');
  }

  await Promise.all([
    updateCognitoUserAttributes(existing.email, {
      displayName: input.displayName,
      firstName: input.firstName,
      lastName: input.lastName
    }),
    input.role ? setCognitoUserRole(existing.email, input.role) : Promise.resolve()
  ]);

  return updated;
};

export const deleteUserAccount = async (userId: string) => {
  const existing = await getUserById(userId);
  if (!existing) {
    return;
  }

  await Promise.all([
    deleteCognitoUser(existing.email),
    deleteUser(userId)
  ]);
};
