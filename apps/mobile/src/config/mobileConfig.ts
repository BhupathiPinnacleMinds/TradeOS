import { resolveMobileRuntimeConfig } from '@tradieos/shared';

declare const process: {
  env?: {
    EXPO_PUBLIC_API_URL?: string;
    EXPO_PUBLIC_APP_ENV?: string;
  };
};

export const mobileConfig = resolveMobileRuntimeConfig({
  apiBaseUrl: process.env?.EXPO_PUBLIC_API_URL,
  environment: process.env?.EXPO_PUBLIC_APP_ENV,
});

export const apiUrl = mobileConfig.apiBaseUrl;
