CREATE TABLE console_login_attempts (
    ip_hash text PRIMARY KEY,
    failures integer NOT NULL DEFAULT 0,
    locked_until timestamptz,
    updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE console_sessions (
    id uuid PRIMARY KEY,
    actor_slot integer NOT NULL CHECK (actor_slot BETWEEN 1 AND 3),
    expires_at timestamptz NOT NULL,
    sudo_until timestamptz,
    revoked_at timestamptz,
    created_at timestamptz NOT NULL DEFAULT now()
);
