import {
  AdminAddUserToGroupCommand,
  AdminCreateUserCommand,
  AdminCreateUserCommandOutput,
  AdminDeleteUserCommand,
  AdminListGroupsForUserCommand,
  AdminRemoveUserFromGroupCommand,
  AdminUpdateUserAttributesCommand
} from '@aws-sdk/client-cognito-identity-provider';

import { cognitoClient } from '../lib/clients';
import {
  ADMIN_TEMP_PASSWORD,
  DEFAULT_USER_TEMP_PASSWORD,
  USER_POOL_ID
} from '../lib/env';

type CognitoRoleGroup = 'admins' | 'students';

const getDefaultGroupForRole = (role: 'admin' | 'student'): CognitoRoleGroup =>
  role === 'admin' ? 'admins' : 'students';

const extractSub = (output: AdminCreateUserCommandOutput): string | undefined => {
  const attributes = output.User?.Attributes ?? [];
  return attributes.find((attr) => attr.Name === 'sub')?.Value;
};

export interface CognitoCreateUserInput {
  email: string;
  displayName: string;
  userId: string;
  role: 'admin' | 'student';
  temporaryPassword?: string;
  firstName?: string;
  lastName?: string;
}

export interface CognitoCreateUserResult {
  username: string;
  sub: string;
}

export const createCognitoUser = async (
  input: CognitoCreateUserInput
): Promise<CognitoCreateUserResult> => {
  const temporaryPassword =
    input.temporaryPassword ?? (input.role === 'admin' ? ADMIN_TEMP_PASSWORD : DEFAULT_USER_TEMP_PASSWORD);

  const command = new AdminCreateUserCommand({
    UserPoolId: USER_POOL_ID,
    Username: input.email,
    TemporaryPassword: temporaryPassword,
    MessageAction: 'SUPPRESS',
    UserAttributes: [
      { Name: 'email', Value: input.email },
      { Name: 'email_verified', Value: 'true' },
      { Name: 'name', Value: input.displayName },
      ...(input.firstName ? [{ Name: 'given_name', Value: input.firstName }] : []),
      ...(input.lastName ? [{ Name: 'family_name', Value: input.lastName }] : []),
      { Name: 'preferred_username', Value: input.userId },
      { Name: 'custom:role', Value: input.role }
    ]
  });

  const response = await cognitoClient.send(command);
  const sub = extractSub(response);

  if (!sub) {
    throw new Error('Failed to determine Cognito user sub');
  }

  const group = getDefaultGroupForRole(input.role);
  await cognitoClient.send(
    new AdminAddUserToGroupCommand({
      UserPoolId: USER_POOL_ID,
      Username: input.email,
      GroupName: group
    })
  );

  return {
    username: response.User?.Username ?? input.email,
    sub
  };
};

export const updateCognitoUserAttributes = async (
  email: string,
  attributes: { displayName?: string; firstName?: string; lastName?: string }
) => {
  const userAttributes = [] as { Name: string; Value: string }[];

  if (attributes.displayName !== undefined) {
    userAttributes.push({ Name: 'name', Value: attributes.displayName ?? '' });
  }

  if (attributes.firstName !== undefined) {
    userAttributes.push({ Name: 'given_name', Value: attributes.firstName });
  }

  if (attributes.lastName !== undefined) {
    userAttributes.push({ Name: 'family_name', Value: attributes.lastName });
  }

  if (userAttributes.length === 0) {
    return;
  }

  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: userAttributes
    })
  );
};

export const setCognitoUserRole = async (email: string, role: 'admin' | 'student') => {
  const currentGroupsResponse = await cognitoClient.send(
    new AdminListGroupsForUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email
    })
  );

  const desiredGroup = getDefaultGroupForRole(role);
  const currentGroups = currentGroupsResponse.Groups?.map((group) => group.GroupName) ?? [];

  await Promise.all(
    currentGroups
      .filter((group): group is string => Boolean(group) && group !== desiredGroup)
      .map((group) =>
        cognitoClient.send(
          new AdminRemoveUserFromGroupCommand({
            UserPoolId: USER_POOL_ID,
            Username: email,
            GroupName: group
          })
        )
      )
  );

  if (!currentGroups.includes(desiredGroup)) {
    await cognitoClient.send(
      new AdminAddUserToGroupCommand({
        UserPoolId: USER_POOL_ID,
        Username: email,
        GroupName: desiredGroup
      })
    );
  }

  await cognitoClient.send(
    new AdminUpdateUserAttributesCommand({
      UserPoolId: USER_POOL_ID,
      Username: email,
      UserAttributes: [{ Name: 'custom:role', Value: role }]
    })
  );
};

export const deleteCognitoUser = async (email: string) => {
  await cognitoClient.send(
    new AdminDeleteUserCommand({
      UserPoolId: USER_POOL_ID,
      Username: email
    })
  );
};
