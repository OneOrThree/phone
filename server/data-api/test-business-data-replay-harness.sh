#!/usr/bin/env bash
# PR896: 실제 Business -> Data 완료 전환 재생 harness. 공유 DB/서비스에는 접속하지 않는다.
set -euo pipefail

root_dir=$(cd "$(dirname "$0")/../.." && pwd)
data_dir="$root_dir/server/data-api"
business_dir="$root_dir/server/business-api"
work_dir=$(mktemp -d)
postgres_name="pr896-replay-$RANDOM-$RANDOM"
data_pid=''
business_pid=''

cleanup() {
  result=$?
  [[ -n "$business_pid" ]] && kill "$business_pid" 2>/dev/null || true
  [[ -n "$data_pid" ]] && kill "$data_pid" 2>/dev/null || true
  docker rm -f "$postgres_name" >/dev/null 2>&1 || true
  if [[ "$result" = 0 ]]; then
    rm -rf "$work_dir"
  else
    echo "harness failed; retained logs at $work_dir" >&2
  fi
}
trap cleanup EXIT

free_port() {
  python3 - <<'PY'
import socket
s = socket.socket()
s.bind(("127.0.0.1", 0))
print(s.getsockname()[1])
s.close()
PY
}

postgres_port=$(free_port)
data_port=$(free_port)
business_port=$(free_port)
token='pr896-business-to-data-test-token'

docker run --name "$postgres_name" -e POSTGRES_DB=pr896 -e POSTGRES_USER=pr896 \
  -e POSTGRES_PASSWORD=pr896 -p "127.0.0.1:$postgres_port:5432" -d postgres:16-alpine >/dev/null
until docker exec "$postgres_name" pg_isready -U pr896 -d pr896 >/dev/null; do sleep 1; done

(cd "$data_dir" && ./gradlew bootJar >/dev/null)
(cd "$business_dir" && ./gradlew bootJar >/dev/null)

SPRING_PROFILES_ACTIVE=ci \
SPRING_DATASOURCE_URL="jdbc:postgresql://127.0.0.1:$postgres_port/pr896" \
SPRING_DATASOURCE_USERNAME=pr896 SPRING_DATASOURCE_PASSWORD=pr896 \
SPRING_FLYWAY_ENABLED=true SPRING_JPA_HIBERNATE_DDL_AUTO=validate \
INTERNAL_API_ENABLED=true INTERNAL_API_CALLERS_BUSINESS_TOKEN="$token" \
INTERNAL_API_CALLERS_BUSINESS_ALLOW_0='POST /internal/auth/login-attempts/lookup' \
INTERNAL_API_CALLERS_BUSINESS_ALLOW_1='DELETE /internal/users/*' \
SERVER_TOMCAT_BASEDIR="$work_dir/tomcat" SERVER_TOMCAT_ACCESSLOG_ENABLED=true \
SERVER_PORT="$data_port" java -jar "$data_dir/build/libs/phone-0.0.1-SNAPSHOT.jar" >"$work_dir/data.log" 2>&1 &
data_pid=$!

for _ in $(seq 1 90); do
  if curl -fsS -X POST "http://127.0.0.1:$data_port/api/v1/auth/guest" >"$work_dir/source.json"; then break; fi
  sleep 1
done
test -s "$work_dir/source.json"
curl -fsS -X POST "http://127.0.0.1:$data_port/api/v1/auth/guest" >"$work_dir/target.json"

python3 - "$work_dir/target.json" >"$work_dir/target-setup.sql" <<'PY'
import base64, json, sys, uuid
target = json.load(open(sys.argv[1]))
claims = json.loads(base64.urlsafe_b64decode(target['accessToken'].split('.')[1] + '=='))
social = str(uuid.uuid4())
user = claims['sub']
print("UPDATE users SET is_guest = false WHERE id = '%s';" % user)
print("INSERT INTO social_accounts (id, user_id, provider, provider_id, created_at) VALUES ('%s', '%s', 'APPLE', 'pr896-target-%s', now());" % (social, user, social))
json.dump({'targetUser': user, 'socialAccount': social}, open(sys.argv[1] + '.setup.json', 'w'))
PY
docker exec -i "$postgres_name" psql -v ON_ERROR_STOP=1 -U pr896 -d pr896 <"$work_dir/target-setup.sql"
curl -fsS -X POST "http://127.0.0.1:$data_port/api/v1/auth/refresh" \
  -H 'Content-Type: application/json' --data "{\"refreshToken\":\"$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["refreshToken"])' "$work_dir/target.json")\"}" >"$work_dir/target-refreshed.json"
python3 - "$work_dir/target.json" "$work_dir/target-refreshed.json" >"$work_dir/target-normal.json" <<'PY'
import json, sys
original, refreshed = (json.load(open(path)) for path in sys.argv[1:])
original['accessToken'] = refreshed['accessToken']
json.dump(original, sys.stdout)
PY
mv "$work_dir/target-normal.json" "$work_dir/target.json"
python3 - "$work_dir/target.json" >"$work_dir/target-refresh-hash.sql" <<'PY'
import base64, hashlib, hmac, json, sys
path = sys.argv[1]
target = json.load(open(path))
refresh_claims = json.loads(base64.urlsafe_b64decode(target['refreshToken'].split('.')[1] + '=='))
payload = {'sub': refresh_claims['sub'], 'type': 'refresh', 'guest': False,
           'jti': refresh_claims['jti'], 'iat': refresh_claims['iat'], 'exp': refresh_claims['exp']}
encode = lambda value: base64.urlsafe_b64encode(value).rstrip(b'=').decode()
unsigned = encode(b'{"alg":"HS512"}') + '.' + encode(json.dumps(payload, separators=(',', ':')).encode())
token = unsigned + '.' + encode(hmac.new(
    b'ci-test-secret-key-that-is-at-least-256-bits-long-padded-for-hmac-sha256',
    unsigned.encode(), hashlib.sha512).digest())
target['refreshToken'] = token
json.dump(target, open(path, 'w'))
session = json.loads(base64.urlsafe_b64decode(target['accessToken'].split('.')[1] + '=='))['sid']
print("UPDATE auth_sessions SET refresh_token_hash = '%s' WHERE id = '%s';" % (hashlib.sha256(token.encode()).hexdigest(), session))
PY
docker exec -i "$postgres_name" psql -v ON_ERROR_STOP=1 -U pr896 -d pr896 <"$work_dir/target-refresh-hash.sql"

read -r source_user source_session source_generation source_access <<EOF
$(python3 - "$work_dir/source.json" <<'PY'
import base64, json, sys
source = json.load(open(sys.argv[1]))['accessToken']
claims = json.loads(base64.urlsafe_b64decode(source.split('.')[1] + '=='))
print(claims['sub'], claims['sid'], claims['gen'], source)
PY
)
EOF
withdraw_status=$(curl -sS -o "$work_dir/withdraw.json" -w '%{http_code}' -X DELETE \
  "http://127.0.0.1:$data_port/internal/users/$source_user" -H "Authorization: Bearer $token" \
  -H "X-User-Id: $source_user" -H "X-Session-Id: $source_session" \
  -H "X-Auth-Generation: $source_generation")
test "$withdraw_status" = 200

python3 - "$work_dir/source.json" "$work_dir/target.json" "$work_dir/target.json.setup.json" >"$work_dir/fixture.sql" <<'PY'
import base64, datetime, hashlib, hmac, json, sys, uuid
source, target, setup = (json.load(open(path)) for path in sys.argv[1:])
def claims(token):
    part = token.split('.')[1] + '=='
    return json.loads(base64.urlsafe_b64decode(part))
def instant(epoch):
    return datetime.datetime.fromtimestamp(epoch, datetime.timezone.utc).isoformat()
s, t = claims(source['accessToken']), claims(target['accessToken'])
r = claims(target['refreshToken'])
secret = b'ci-test-login-attempt-digest-secret'
separator = '\0'
key_id = hmac.new(secret, ('key-id' + separator + 'gromo-1908').encode(), hashlib.sha256).hexdigest()[:16]
digest = hmac.new(secret, ('apple' + separator + 'id_token' + separator + 'replay-credential').encode(), hashlib.sha256).hexdigest()
attempt = str(uuid.uuid4())
now = datetime.datetime.now(datetime.timezone.utc)
recovery = now + datetime.timedelta(minutes=4)
sql = """INSERT INTO login_attempts (attempt_id,status,digest_key_id,credential_digest,provider,credential_kind,terms_version,user_id,session_id,onboarding_complete,token_guest,auth_generation,access_issued_at,access_expires_at,refresh_issued_at,refresh_expires_at,refresh_jti,account_switch_confirmed,switch_phase,switch_source_user_id,switch_source_session_id,switch_source_auth_generation,switch_target_user_id,switch_target_social_account_id,switch_verified_at,claimed_at,completed_at,recovery_expires_at,created_at,updated_at) VALUES ('{attempt}','COMPLETED','{key_id}','{digest}','APPLE','id_token','2026-09','{target_user}','{target_session}',false,{target_guest},{target_gen},'{access_iat}','{access_exp}','{refresh_iat}','{refresh_exp}','{refresh_jti}',true,'GUEST_WITHDRAWN','{source_user}','{source_session}',{source_gen},'{target_user}','{social_id}','{now}','{now}','{now}','{recovery}','{now}','{now}');""".format(
    attempt=attempt, key_id=key_id, digest=digest, target_user=t['sub'], target_session=t['sid'], target_gen=t['gen'],
    access_iat=instant(t['iat']), access_exp=instant(t['exp']), refresh_iat=instant(r['iat']), refresh_exp=instant(r['exp']),
    refresh_jti=r['jti'], source_user=s['sub'], source_session=s['sid'], source_gen=s['gen'],
    now=now.isoformat(), recovery=recovery.isoformat(), social_id=setup['socialAccount'],
    target_guest=str(t['guest']).lower())
print(sql)
json.dump({'attempt': attempt, 'source': source['accessToken'], 'target': target['accessToken'],
           'targetUser': t['sub'], 'targetSession': t['sid'], 'targetGeneration': t['gen'],
           'targetGuest': t['guest'], 'sourceUser': s['sub'], 'socialAccount': setup['socialAccount']},
          open(sys.argv[1] + '.fixture.json', 'w'))
PY
docker exec -i "$postgres_name" psql -v ON_ERROR_STOP=1 -U pr896 -d pr896 <"$work_dir/fixture.sql"
source_user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["sourceUser"])' "$work_dir/source.json.fixture.json")
target_user=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["targetUser"])' "$work_dir/source.json.fixture.json")
social_account=$(python3 -c 'import json,sys; print(json.load(open(sys.argv[1]))["socialAccount"])' "$work_dir/source.json.fixture.json")
test "$(docker exec "$postgres_name" psql -At -U pr896 -d pr896 -c "select count(*) from users where id='$source_user' and is_deleted=true")" = 1
test "$(docker exec "$postgres_name" psql -At -U pr896 -d pr896 -c "select count(*) from auth_sessions where user_id='$source_user' and revoked_at is null")" = 0
test "$(docker exec "$postgres_name" psql -At -U pr896 -d pr896 -c "select count(*) from users u join social_accounts s on s.user_id=u.id where u.id='$target_user' and u.is_guest=false and s.id='$social_account' and s.deleted_at is null")" = 1

SPRING_PROFILES_ACTIVE=ci SERVER_PORT="$business_port" \
BUSINESS_UPSTREAM_DATA_BASE_URL="http://127.0.0.1:$data_port" \
BUSINESS_UPSTREAM_DATA_SERVICE_TOKEN="$token" \
java -jar "$business_dir/build/libs/business-api.jar" >"$work_dir/business.log" 2>&1 &
business_pid=$!
for _ in $(seq 1 90); do
  if curl -sS -o /dev/null "http://127.0.0.1:$business_port/no-such-route"; then break; fi
  sleep 1
done

python3 - "$work_dir/source.json.fixture.json" "$business_port" "$work_dir" <<'PY'
import base64, json, subprocess, sys
fixture, port, out = json.load(open(sys.argv[1])), sys.argv[2], sys.argv[3]
target_claims = json.loads(base64.urlsafe_b64decode(fixture['target'].split('.')[1] + '=='))
assert target_claims['sub'] == fixture['targetUser'] and target_claims['guest'] is False
base = ['curl', '-sS', '-D', '-', '-o', out + '/body', '-X', 'POST', 'http://127.0.0.1:' + port + '/auth/sessions', '-H', 'Content-Type: application/json', '-H', 'X-Login-Attempt-Id: ' + fixture['attempt'], '-H', 'Authorization: Bearer ' + fixture['source']]
body = '{"provider":"apple","credential":{"type":"id_token","value":"replay-credential"},"termsVersion":"2026-09","accountSwitchConfirmed":true}'
reply = subprocess.check_output(base + ['--data', body], text=True)
response = json.load(open(out + '/body'))
replayed = json.loads(base64.urlsafe_b64decode(response['data']['accessToken'].split('.')[1] + '=='))
assert ' 201 ' in reply and replayed['sub'] == fixture['targetUser'], reply
assert replayed['guest'] is fixture['targetGuest'] is False
assert replayed['sid'] == fixture['targetSession'] and replayed['gen'] == fixture['targetGeneration']
tampered = subprocess.check_output(base + ['--data', body.replace('2026-09', '2026-10')], text=True)
assert ' 409 ' in tampered, tampered
bad_source = base.copy()
bad_source[bad_source.index('Authorization: Bearer ' + fixture['source'])] = 'Authorization: Bearer ' + fixture['target']
bad_source += ['--data', body]
rejected = subprocess.check_output(bad_source, text=True)
assert ' 401 ' in rejected, rejected
PY

sessions=$(docker exec "$postgres_name" psql -At -U pr896 -d pr896 -c "select count(*) from auth_sessions")
test "$sessions" = 2
# Tomcat access log은 프로세스 종료에서 flush된다. 이후에는 Data에 더 요청하지 않는다.
kill "$data_pid"
wait "$data_pid" || true
data_pid=''
lookup_requests=$( (grep -Rh 'POST /internal/auth/login-attempts/lookup HTTP' "$work_dir/tomcat" 2>/dev/null || true) | wc -l | tr -d ' ')
execute_requests=$( (grep -Rh 'POST /internal/auth/login-attempts HTTP' "$work_dir/tomcat" 2>/dev/null || true) | wc -l | tr -d ' ')
test "$lookup_requests" = 3
test "$execute_requests" = 0
echo "PR896 Business->Data completed switch replay harness passed (withdrawn source, linked non-guest target, execute 0)."
