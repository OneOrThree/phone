CREATE TABLE publication_cancellations (
    publication_id uuid PRIMARY KEY,
    actor text NOT NULL,
    cancelled_at timestamptz NOT NULL
);
