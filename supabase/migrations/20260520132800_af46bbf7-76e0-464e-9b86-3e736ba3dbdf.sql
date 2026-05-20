-- Lock down the internal MP token reader to service_role only.
-- Any logged-in user must NOT be able to read other stores' decrypted tokens.
REVOKE ALL ON FUNCTION public.get_mp_access_token_internal(uuid) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.get_mp_access_token_internal(uuid) TO service_role;