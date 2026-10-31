ALTER TABLE developer_notices
    ADD COLUMN withdrawn_at timestamptz,
    ADD COLUMN withdrawn_by varchar(16),
    ADD CONSTRAINT developer_notices_withdrawal_pair CHECK
        ((withdrawn_at IS NULL AND withdrawn_by IS NULL)
         OR (withdrawn_at IS NOT NULL AND withdrawn_by IN ('member-1','member-2','member-3')));
