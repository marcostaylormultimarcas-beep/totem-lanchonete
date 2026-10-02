export interface CheckoutQuoteReadinessInput {
  deviceOwnedKiosk: boolean;
  demoMode: boolean;
  quoteLoading: boolean;
  quoteError: string;
  serverQuote: unknown;
}

export const isCheckoutQuoteReady = ({
  deviceOwnedKiosk,
  demoMode,
  quoteLoading,
  quoteError,
  serverQuote,
}: CheckoutQuoteReadinessInput): boolean => {
  if (deviceOwnedKiosk || demoMode) return true;
  return !quoteLoading && !quoteError && Boolean(serverQuote);
};
