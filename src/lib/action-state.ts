export type ActionState = {
  errors?: Record<string, string>;
  message?: string;
  success?: boolean;
};

export const idle: ActionState = {};
