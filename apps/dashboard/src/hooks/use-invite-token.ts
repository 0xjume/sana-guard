'use client';

import { useEffect, useState } from 'react';
import { publicConfig } from '@/lib/config';

const STORAGE_KEY = 'sana-guard.invite-token';

export function useInviteToken() {
  const [token, setToken] = useState('');

  useEffect(() => {
    const stored = window.localStorage.getItem(STORAGE_KEY);
    setToken(stored ?? publicConfig.defaultInviteToken ?? '');
  }, []);

  const save = (next: string) => {
    setToken(next);
    window.localStorage.setItem(STORAGE_KEY, next);
  };

  return { token, save };
}
