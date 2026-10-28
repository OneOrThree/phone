-- 푸시 토큰은 집중 세션의 Live Activity 수명(최대 8시간) 동안만 보관한다.
CREATE TABLE focus_live_activities (
    id uuid PRIMARY KEY,
    session_id uuid NOT NULL UNIQUE REFERENCES focus_session_details(session_id) ON DELETE CASCADE,
    user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    activity_id varchar(128) NOT NULL,
    push_token varchar(1024) NOT NULL,
    environment varchar(16) NOT NULL CHECK (environment IN ('development', 'production')),
    cat_color varchar(16) NOT NULL,
    sent_version bigint NOT NULL,
    sent_timestamp bigint NOT NULL,
    next_attempt_at timestamptz NOT NULL,
    expires_at timestamptz NOT NULL
);
CREATE INDEX focus_live_activities_due_idx ON focus_live_activities(next_attempt_at);
