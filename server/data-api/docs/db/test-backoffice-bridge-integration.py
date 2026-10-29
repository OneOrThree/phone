#!/usr/bin/env python3
"""전용 일회성 PostgreSQL에서 확장 이력의 V0..6 전환을 재현한다. 원격 DB 인자를 받지 않는다."""
import argparse
import copy
import importlib.util
import json
from pathlib import Path
import subprocess
import uuid

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('deploy_bridge', HERE / 'deploy-v0.py')
d = importlib.util.module_from_spec(spec)
spec.loader.exec_module(d)
r = d.rebase
HISTORY = '''CREATE TABLE flyway_schema_history (
installed_rank integer PRIMARY KEY,version varchar(50),description varchar(200) NOT NULL,
type varchar(20) NOT NULL,script varchar(1000) NOT NULL,checksum integer,
installed_by varchar(100) NOT NULL,installed_on timestamp NOT NULL DEFAULT now(),
execution_time integer NOT NULL,success boolean NOT NULL);
CREATE INDEX flyway_schema_history_s_idx ON flyway_schema_history(success);'''


def history_insert(rank, entry):
    description = entry['script'].split('__', 1)[1].removesuffix('.sql').replace('_', ' ')
    return ("INSERT INTO flyway_schema_history(installed_rank,version,description,type,script,checksum,"
            "installed_by,execution_time,success) VALUES (" + str(rank) + ',' + r.quote(entry['version'])
            + ',' + r.quote(description) + ",'SQL'," + r.quote(entry['script']) + ',' + str(entry['checksum'])
            + ',current_user,0,true);')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--generate-profile', action='store_true', help='격리 fixture로 고정 지문을 생성한다')
    args = parser.parse_args()
    container = 'data-backoffice-bridge-' + uuid.uuid4().hex[:12]
    def command(argv, content=None):
        return subprocess.run(argv, input=content, text=True, capture_output=True, check=True).stdout.strip()
    def sql(database, query):
        return command(['docker','exec','-i',container,'psql','-XqAt','-U','audit','-d',database,
                        '-v','ON_ERROR_STOP=1'], 'SET search_path=public,pg_catalog;\n' + query)
    def create(database):
        command(['docker','exec',container,'createdb','-U','audit',database])
    def fingerprint(database):
        return sql(database, 'SELECT ' + r.schema_expression() + ';')
    base = r.load_manifest()
    raw = json.loads((r.ASSETS/'backoffice-profile.json').read_text())
    entry = r.extension_entry()
    canonical = d.bundled_history(base)
    # 브리지는 V0..6 이력까지만 기록한다. 그 뒤 후속 migration(V7 이후)은 deploy-v0.py 의 current migrate 가 적용한다.
    bridged = canonical[:1 + len(raw['bridge_history'])]
    extension_path = r.BASELINE.parent.parent/'migration'/r.EXTENSION_SCRIPT
    def seed_legacy(database, extension=True):
        create(database)
        entries = sorted([*base['source_history'], *([entry] if extension else [])], key=lambda item:d.version(item['version']))
        statements = [HISTORY]
        for rank, item in enumerate(entries,1):
            statements.extend([(r.BASELINE.parent.parent/'migration'/item['script']).read_text(),
                               'SET search_path=public,pg_catalog;',history_insert(rank,item)])
        sql(database,'\n'.join(statements))
    def clone(source, target):
        create(target)
        dump=command(['docker','exec',container,'pg_dump','-U','audit','--no-owner','--no-privileges',source])
        sql(target,dump)
    def transition(manifest):
        cleanup='\n'.join(f'DELETE FROM public.{r.identifier(t)} WHERE {r.identifier(c)} IN (SELECT id FROM retiring_bots);'
                          for t,c in r.CLEANUP.items() if t!='users')
        return r.preparation(manifest)+'\n'+(r.ASSETS/'retire.sql').read_text()+'\n'+cleanup+'\nDELETE FROM users WHERE id IN (SELECT id FROM retiring_bots);'
    try:
        command(['docker','run','-d','--name',container,'--env','POSTGRES_USER=audit',
                 '--env','POSTGRES_PASSWORD=local-bridge-only',r.CLIENT_IMAGE])
        command(['docker','exec',container,'sh','-c','until pg_isready -h 127.0.0.1 -U audit >/dev/null; do sleep 0.1; done'])
        seed_legacy('legacy')
        clone('legacy','restored')
        create('fresh')
        sql('fresh',HISTORY+'\n'+'\n'.join((r.BASELINE.parent/item['script']).read_text()+'\nSET search_path=public,pg_catalog;\n'+history_insert(rank,item)
                                         for rank,item in enumerate(bridged,1)))
        fresh_fingerprint=fingerprint('fresh')
        if args.generate_profile:
            raw['source_schemas']=sorted({fingerprint(name) for name in ('legacy','restored')})
            raw['target_schemas']=[]
            raw['final_schemas']=[fresh_fingerprint]
            for name in ('legacy','restored'):
                probe={**base,'source_tables':sorted(base['source_tables']+r.EXTENSION_TABLES)}
                result=sql(name,'BEGIN;\n'+transition(probe)+'\nSELECT '+r.schema_expression()+';\n'
                           + '\n'.join((r.BASELINE.parent/item['script']).read_text() for item in raw['bridge_history'] if item['version'] in ('1','2','3'))
                           +'\nSELECT '+r.schema_expression()+';\nROLLBACK;').splitlines()
                raw['target_schemas'].append(result[-2])
                raw['final_schemas'].append(result[-1])
            for key in ('target_schemas','final_schemas'): raw[key]=sorted(set(raw[key]))
            (r.ASSETS/'backoffice-profile.json').write_text(json.dumps(raw,indent=2)+'\n')
        manifest=r.extension_profile(base)
        fixture = '''
INSERT INTO content_publications VALUES ('10000000-0000-0000-0000-000000000001','NOTICE',repeat('a',64),'{"status":"PUBLISHED"}','member-1',now());
INSERT INTO developer_notices VALUES ('10000000-0000-0000-0000-000000000001','preserved notice','body',now(),NULL,now());
INSERT INTO content_publications VALUES ('10000000-0000-0000-0000-000000000002','CONSTRUCTION',repeat('b',64),'{"revision":2}','member-2',now());
INSERT INTO magazine_review_snapshots VALUES ('10000000-0000-0000-0000-000000000003',repeat('c',64),'{"editorial":"kept"}','member-1',now());
INSERT INTO focus_reward_policies(revision,seconds_per_fish,daily_cap_fish,personal_share_percent) VALUES (2,120,240,0);
INSERT INTO focus_reward_policy_approvals(approval_id,expected_revision,policy_snapshot,policy_digest,request_digest,approved_by)
VALUES ('10000000-0000-0000-0000-000000000004',1,'{"secondsPerFish":120}',repeat('d',64),repeat('e',64),'member-1');
INSERT INTO focus_reward_policy_publications(publication_id,approval_id,revision,previous_revision,before_policy,after_policy,request_digest,approved_digest,approved_by,actor)
VALUES ('10000000-0000-0000-0000-000000000005','10000000-0000-0000-0000-000000000004',2,1,'{"secondsPerFish":60}','{"secondsPerFish":120}',repeat('f',64),repeat('d',64),'member-1','member-2');
'''
        def receipts(name):
            return {table:sql(name,'SELECT jsonb_agg(to_jsonb(t) ORDER BY to_jsonb(t)::text) FROM '+table+' t;')
                    for table in r.EXTENSION_TABLES+['focus_reward_policies']}
        class Database:
            def __init__(self,name): self.name=name; self.pg={'PGDATABASE':name,'PGUSER':'audit'}
            def sql(self,query): return sql(self.name,query)
            def data(self,query): return json.loads(self.sql(query))
            def fingerprint(self): return fingerprint(self.name)
        sql('legacy',fixture)
        sql('restored',fixture)
        clone('legacy','pending138')
        sql('pending138',"DELETE FROM flyway_schema_history WHERE version='138'")
        assert d.inspect_database(Database('pending138'),base,canonical)['source_version']=='137.1'
        sql('pending138','ALTER TABLE developer_notices ADD COLUMN unexpected integer')
        try:
            d.inspect_database(Database('pending138'),base,canonical)
            raise AssertionError('137.1 schema drift accepted before V138')
        except ValueError: pass
        clone('legacy','rollback')
        baseline_receipts=receipts('rollback')
        baseline_fingerprint=fingerprint('rollback')
        wrong=copy.deepcopy(manifest)
        wrong['final_schemas']=['0'*32]
        try:
            sql('rollback',r.apply_sql(wrong,wrong['v0_checksum']))
            raise AssertionError('final schema mismatch must roll back')
        except subprocess.CalledProcessError: pass
        assert fingerprint('rollback')==baseline_fingerprint
        assert receipts('rollback')==baseline_receipts
        assert d.inspect_database(Database('rollback'),base,canonical)['source_version']=='138'
        sql('rollback',"UPDATE flyway_schema_history SET checksum=0 WHERE version='137.1'")
        try:
            d.inspect_database(Database('rollback'),base,canonical)
            raise AssertionError('unknown extension checksum accepted')
        except ValueError: pass
        sql('rollback',"UPDATE flyway_schema_history SET checksum="+str(entry['checksum'])+" WHERE version='137.1'; ALTER TABLE developer_notices ADD COLUMN unexpected integer")
        try:
            d.inspect_database(Database('rollback'),base,canonical)
            raise AssertionError('unknown schema accepted')
        except ValueError: pass
        seed_legacy('plain138',extension=False)
        assert d.inspect_database(Database('plain138'),base,canonical)['profile']=='original'
        sql('plain138',r.apply_sql(base,base['v0_checksum']))
        sql('plain138','\n'.join((r.BASELINE.parent/item['script']).read_text()+'\n'+history_insert(rank,item)
                                 for rank,item in enumerate(canonical[1:],2)))
        assert d.inspect_database(Database('plain138'),base,canonical)['state']=='current'
        assert fresh_fingerprint in manifest['final_schemas']
        for name in ('legacy','restored'):
            before=receipts(name)
            assert d.inspect_database(Database(name),base,canonical)['profile']=='backoffice-137.1'
            if name=='restored':
                sql(name,"UPDATE flyway_schema_history SET type='BASELINE',checksum=NULL,script='<< baseline >>' WHERE version='1'")
            sql(name,r.apply_sql(manifest,manifest['v0_checksum']))
            assert fingerprint(name) in manifest['final_schemas']
            assert receipts(name)==before
            assert d.inspect_database(Database(name),base,canonical)['state']=='current'
            clone(name,name+'_normalized')
            assert json.loads(sql(name,"SELECT json_agg(version ORDER BY installed_rank) FROM flyway_schema_history"))==['0','1','2','3','4','5','6']
        clone('fresh','fresh_normalized')
        assert fingerprint('legacy_normalized')==fingerprint('fresh_normalized')
        assert fingerprint('restored_normalized')==fingerprint('fresh_normalized')
        print(json.dumps({'preserved_receipts':True,'transaction_rollback':True,'unknown_schema_checksum_rejected':True,
                          'plain138_supported':True,'canonical_schema_after_dump_normalization':True,'fresh':fresh_fingerprint,'source':raw['source_schemas'],'targets':raw['target_schemas'],'final':raw['final_schemas']}))
    except subprocess.CalledProcessError as error:
        raise RuntimeError(error.stderr[-6000:]) from error
    finally:
        subprocess.run(['docker','rm','-f',container],capture_output=True)


if __name__=='__main__': main()
