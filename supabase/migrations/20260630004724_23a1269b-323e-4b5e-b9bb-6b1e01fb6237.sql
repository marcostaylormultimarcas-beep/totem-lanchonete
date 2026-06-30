-- Reset password for existing admin user Marcostaylor2020@gmail.com
UPDATE auth.users
SET encrypted_password = crypt('#Brasil28', gen_salt('bf')),
    email_confirmed_at = COALESCE(email_confirmed_at, now()),
    updated_at = now()
WHERE id = '07316125-3d5a-490f-9d84-c6745996b9f1';