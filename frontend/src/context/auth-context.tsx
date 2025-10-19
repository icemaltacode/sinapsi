import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState
} from 'react';
import type { ReactNode } from 'react';
import {
  confirmSignIn,
  fetchAuthSession,
  getCurrentUser,
  signIn,
  signOut as amplifySignOut
} from 'aws-amplify/auth';

import { apiRequest } from '../lib/api';
import { buildAvatarUrl } from '../lib/avatar';

export type AuthStage = 'loading' | 'signedOut' | 'newPassword' | 'signedIn';

export interface SignInMessage {
  type: 'error' | 'success';
  text: string;
}

export interface AuthUser {
  username: string;
  email?: string;
  displayName?: string;
  firstName?: string;
  lastName?: string;
  avatarKey?: string | null;
  avatarUrl?: string;
  groups: string[];
}

interface AuthContextValue {
  stage: AuthStage;
  loading: boolean;
  message: SignInMessage | null;
  user: AuthUser | null;
  idToken: string | null;
  isAdmin: boolean;
  signInUser: (username: string, password: string) => Promise<void>;
  completeNewPassword: (newPassword: string) => Promise<void>;
  signOut: () => Promise<void>;
  clearMessage: () => void;
  refreshProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

const extractGroups = (session: Awaited<ReturnType<typeof fetchAuthSession>>) => {
  const payload = session.tokens?.idToken?.payload as Record<string, unknown> | undefined;
  const groups = (payload?.['cognito:groups'] as string[]) ?? [];
  return Array.isArray(groups) ? groups : [];
};

export const AuthProvider = ({ children }: { children: ReactNode }) => {
  const [stage, setStage] = useState<AuthStage>('loading');
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState<SignInMessage | null>(null);
  const [user, setUser] = useState<AuthUser | null>(null);
  const [idToken, setIdToken] = useState<string | null>(null);

  const updateFromSession = useCallback(async () => {
    const session = await fetchAuthSession();
    const idToken = session.tokens?.idToken;
    const tokenString = idToken?.toString();
    if (!tokenString) {
      throw new Error('Session found but ID token missing');
    }

    const payload = (idToken?.payload ?? {}) as Record<string, unknown>;
    const cognitoUser = await getCurrentUser();
    const groups = extractGroups(session);

    let profile:
      | {
          user?: {
            displayName?: string;
            firstName?: string;
            lastName?: string;
            avatarKey?: string | null;
          };
        }
      | undefined;

    try {
      profile = await apiRequest<{ user: { displayName?: string; firstName?: string; lastName?: string; avatarKey?: string | null } }>(
        '/account/profile',
        { token: tokenString }
      );
    } catch (error) {
      console.debug('Unable to fetch profile details', error);
    }

    setIdToken(tokenString);
    setUser({
      username: cognitoUser.username,
      email: (payload.email as string) ?? cognitoUser?.signInDetails?.loginId,
      displayName: profile?.user?.displayName ?? (payload.name as string) ?? cognitoUser.username,
      firstName: profile?.user?.firstName ?? (payload.given_name as string | undefined),
      lastName: profile?.user?.lastName ?? (payload.family_name as string | undefined),
      avatarKey: profile?.user?.avatarKey ?? undefined,
      avatarUrl: buildAvatarUrl(profile?.user?.avatarKey),
      groups
    });
    setStage('signedIn');
  }, []);

  useEffect(() => {
    (async () => {
      try {
        await updateFromSession();
      } catch (error) {
        console.debug('No existing Cognito session', error);
        setStage('signedOut');
      }
    })();
  }, [updateFromSession]);

  const signInUser = useCallback(
    async (username: string, password: string) => {
      setLoading(true);
      setMessage(null);
      try {
        const { isSignedIn, nextStep } = await signIn({ username, password });
        if (nextStep.signInStep === 'CONFIRM_SIGN_IN_WITH_NEW_PASSWORD_REQUIRED') {
          setStage('newPassword');
          setMessage({
            type: 'success',
            text: 'A new password is required. Please set one below.'
          });
        } else if (isSignedIn) {
          await updateFromSession();
        } else {
          setMessage({
            type: 'error',
            text: 'Unable to sign in. Please try again later.'
          });
        }
      } catch (error) {
        const text =
          error instanceof Error ? error.message : 'Unable to sign in right now.';
        setMessage({ type: 'error', text });
      } finally {
        setLoading(false);
      }
    },
    [updateFromSession]
  );

  const completeNewPassword = useCallback(
    async (newPassword: string) => {
      setLoading(true);
      setMessage(null);
      try {
        await confirmSignIn({ challengeResponse: newPassword });
        await updateFromSession();
        setMessage({ type: 'success', text: 'Password updated successfully.' });
      } catch (error) {
        const text =
          error instanceof Error ? error.message : 'Unable to set the new password.';
        setMessage({ type: 'error', text });
      } finally {
        setLoading(false);
      }
    },
    [updateFromSession]
  );

  const signOut = useCallback(async () => {
    await amplifySignOut();
    setUser(null);
    setIdToken(null);
    setStage('signedOut');
    setMessage({ type: 'success', text: 'Signed out.' });
  }, []);

  const clearMessage = useCallback(() => setMessage(null), []);

  const isAdmin = useMemo(() => user?.groups.includes('admins') ?? false, [user]);

  const refreshProfile = useCallback(async () => {
    if (!idToken) return;
    try {
      const response = await apiRequest<{ user: { displayName?: string; firstName?: string; lastName?: string; avatarKey?: string | null } }>(
        '/account/profile',
        { token: idToken }
      );

      setUser((prev) =>
        prev
          ? {
              ...prev,
              displayName: response.user.displayName ?? prev.displayName,
              firstName: response.user.firstName ?? prev.firstName,
              lastName: response.user.lastName ?? prev.lastName,
              avatarKey: response.user.avatarKey ?? prev.avatarKey,
              avatarUrl: buildAvatarUrl(response.user.avatarKey ?? prev.avatarKey)
            }
          : prev
      );
    } catch (error) {
      console.error('Failed to refresh profile', error);
    }
  }, [idToken]);

  const value = useMemo<AuthContextValue>(
    () => ({
      stage,
      loading,
      message,
      user,
      idToken,
      isAdmin,
      signInUser,
      completeNewPassword,
      signOut,
      clearMessage,
      refreshProfile
    }),
    [
      stage,
      loading,
      message,
      user,
      idToken,
      isAdmin,
      signInUser,
      completeNewPassword,
      signOut,
      clearMessage,
      refreshProfile
    ]
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

// eslint-disable-next-line react-refresh/only-export-components
export const useAuth = () => {
  const ctx = useContext(AuthContext);
  if (!ctx) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return ctx;
};
