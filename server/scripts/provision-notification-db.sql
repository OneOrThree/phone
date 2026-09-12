-- PostgreSQL 16 psql 전용. https://www.postgresql.org/docs/16/app-psql.html
-- CREATE DATABASE는 트랜잭션 밖에서 실행하되 session advisory lock으로 동시 실행을 직렬화한다.
\set ON_ERROR_STOP on
\set ECHO none
\getenv noti_user NOTI_DB_USERNAME
\getenv noti_password NOTI_DB_PASSWORD
\getenv data_user API_DB_USERNAME
\getenv core_db CORE_DB_NAME

SELECT pg_advisory_lock(hashtext('gromo_notification_provision'));
SELECT set_config('gromo.provision_noti_user', :'noti_user', false);
SELECT set_config('gromo.provision_data_user', :'data_user', false);
SELECT set_config('gromo.provision_core_db', :'core_db', false);

DO $$
DECLARE
    data_role pg_roles%ROWTYPE;
    noti_role pg_roles%ROWTYPE;
BEGIN
    IF current_setting('gromo.provision_noti_user') = current_setting('gromo.provision_data_user')
       OR current_setting('gromo.provision_core_db') = 'gromo_notification' THEN
        RAISE EXCEPTION '코어와 알림의 계정 및 database는 서로 달라야 합니다';
    END IF;
    SELECT * INTO data_role FROM pg_roles WHERE rolname = current_setting('gromo.provision_data_user');
    IF NOT FOUND OR data_role.rolsuper OR data_role.rolcreatedb OR data_role.rolcreaterole THEN
        RAISE EXCEPTION 'Data API에 관리자가 아닌 전용 계정을 먼저 준비해야 합니다';
    END IF;
    IF EXISTS (
        SELECT FROM pg_roles r WHERE (r.rolsuper OR r.rolcreatedb OR r.rolcreaterole OR r.rolname = 'rds_superuser')
        AND pg_has_role(data_role.oid, r.oid, 'MEMBER')
    ) THEN
        RAISE EXCEPTION 'Data API 계정에 관리자 역할을 상속하거나 전환할 권한이 있습니다';
    END IF;
    IF NOT EXISTS (SELECT FROM pg_database WHERE datname = current_setting('gromo.provision_core_db')) THEN
        RAISE EXCEPTION '기존 코어 database가 없습니다';
    END IF;
    SELECT * INTO noti_role FROM pg_roles WHERE rolname = current_setting('gromo.provision_noti_user');
    IF FOUND AND (noti_role.rolsuper OR noti_role.rolcreatedb OR noti_role.rolcreaterole
                  OR EXISTS (SELECT FROM pg_auth_members WHERE member = noti_role.oid)) THEN
        RAISE EXCEPTION '기존 알림 계정에 관리자 또는 다른 역할의 권한이 있습니다';
    END IF;
    IF noti_role.oid IS NOT NULL AND pg_has_role(data_role.oid, noti_role.oid, 'MEMBER') THEN
        RAISE EXCEPTION 'Data API 계정이 알림 역할로 전환할 수 있습니다';
    END IF;
    -- 반대 방향의 grant도 검사한다. NOLOGIN 중간 역할과 ADMIN-only 재부여 경로도 거부한다.
    -- PG16은 비슈퍼 CREATEROLE 생성자에게 ADMIN membership을 자동 부여한다.
    -- https://www.postgresql.org/docs/16/role-attributes.html
    -- 슈퍼유저와 현재 프로비저닝 CREATEROLE 관리자만 예외로 하며 그 하위 수신자는 따로 검사한다.
    IF noti_role.oid IS NOT NULL AND EXISTS (
        SELECT FROM pg_roles r WHERE r.oid <> noti_role.oid AND NOT r.rolsuper
        AND NOT (r.rolname = current_user AND r.rolcreaterole)
        AND pg_has_role(r.oid, noti_role.oid, 'MEMBER')
    ) THEN
        RAISE EXCEPTION '다른 계정 또는 역할이 알림 역할의 권한을 받을 수 있습니다';
    END IF;
    IF EXISTS (SELECT FROM pg_database WHERE datname = current_setting('gromo.provision_core_db')
               AND datdba = noti_role.oid) THEN
        RAISE EXCEPTION '알림 계정이 기존 코어 database를 소유하고 있습니다';
    END IF;
    IF EXISTS (
        SELECT FROM pg_database d JOIN pg_roles r ON r.oid = d.datdba
        WHERE d.datname = 'gromo_notification' AND r.rolname <> current_setting('gromo.provision_noti_user')
    ) THEN
        RAISE EXCEPTION '기존 알림 database 소유자가 다릅니다. 자동으로 소유권을 바꾸지 않습니다';
    END IF;
END $$;

SELECT format('CREATE ROLE %I LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOINHERIT', :'noti_user')
WHERE NOT EXISTS (SELECT FROM pg_roles WHERE rolname = :'noti_user')
\gexec
SELECT format('ALTER ROLE %I LOGIN PASSWORD %L', :'noti_user', :'noti_password')
\gexec
SELECT format('CREATE DATABASE gromo_notification OWNER %I', :'noti_user')
WHERE NOT EXISTS (SELECT FROM pg_database WHERE datname = 'gromo_notification')
\gexec

-- database의 PUBLIC CONNECT 기본권한도 제거해야 전용 계정만으로 DB 격리가 성립한다.
SELECT format('REVOKE ALL ON DATABASE gromo_notification FROM PUBLIC')
\gexec
SELECT format('REVOKE ALL ON DATABASE gromo_notification FROM %I', :'data_user')
\gexec
SELECT format('REVOKE CONNECT ON DATABASE %I FROM PUBLIC', :'core_db')
\gexec
SELECT format('REVOKE ALL ON DATABASE %I FROM %I', :'core_db', :'noti_user')
\gexec
SELECT format('GRANT CONNECT ON DATABASE %I TO %I', :'core_db', :'data_user')
\gexec
SELECT pg_advisory_unlock(hashtext('gromo_notification_provision'));
