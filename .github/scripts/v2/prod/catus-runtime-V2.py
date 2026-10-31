#!/usr/bin/env python3
"""V2 이미지·구성 발행, 고정 SSM 실행 및 운영 결과 게시."""
import argparse
import base64
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import time
import zipfile

REGION='ap-northeast-2'
BUCKET='catus-prod-deploy-artifacts-808715036056-v2'
ROLES=('app','kafka','redis','backoffice')
PREFIX={'app':'catus','kafka':'kafka','redis':'redis','backoffice':'backoffice'}
# 역할별 운영 발행·배포 브랜치. 백오피스는 main 머지로 배포하고(GROMO-2666), 롤백할 이전 태그는 release 에서 발행됐다.
BRANCHES={'backoffice':('main','release')}
ROOT=Path(__file__).resolve().parents[4]
# 앱 릴리스 번들에 평면 이름으로 넣는 관측 설정(번들 이름 → 저장소 원본). Infra 배포 엔진과의 계약(GROMO-2619 §2)이다.
OBSERVABILITY_FILES={
    'fluent-bit-V2.conf':'server/observability/fluent-bit/fluent-bit.conf',
    'fluent-bit-parsers-V2.conf':'server/observability/fluent-bit/parsers.conf',
    'fluent-bit-logs-V2.lua':'server/observability/fluent-bit/logs.lua',
    'fluent-bit-s3-on-V2.conf':'server/observability/fluent-bit/modules/s3-on/s3.conf',
    'fluent-bit-s3-off-V2.conf':'server/observability/fluent-bit/modules/s3/off.conf',
    'fluent-bit-nginx-off-V2.conf':'server/observability/fluent-bit/modules/nginx-host/off.conf',
    'loki-V2.yml':'server/observability/loki/loki-config.yml',
    'grafana-log-investigation-V2.json':'server/observability/grafana/dashboards/log-investigation.json'}


def run(args,**kwargs):
    return subprocess.run(args,check=True,capture_output=True,text=True,timeout=kwargs.pop('timeout',600),**kwargs).stdout


def aws(*args):return json.loads(run(['aws','--region',REGION,*args,'--output','json']))


def config():
    result=json.loads(aws('secretsmanager','get-secret-value','--secret-id','catus/prod/cicd-V2')['SecretString'])
    if result.get('STACK')!='V2' or result.get('DEPLOY_BUCKET')!=BUCKET:raise ValueError('V2 config only')
    return result


def version(value,role):
    match=re.fullmatch(re.escape(PREFIX[role])+r'-v(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)-V2',value)
    if not match:raise ValueError('V2 version format')
    return tuple(map(int,match.groups()))


def previous(role):
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/'current.json'
        try:aws('s3api','get-object','--bucket',BUCKET,'--key',f'deployments/{role}/current-V2.json',str(path))
        except subprocess.CalledProcessError as e:
            if 'NoSuchKey' in (e.stderr or '') or '(404)' in (e.stderr or ''):return None
            raise
        result=json.loads(path.read_text())
        if result.get('stack')!='V2' or result.get('role')!=role:raise ValueError('Invalid prior state')
        return result


def planner(role,prior=None,pr_base=None):
    revision=run(['git','rev-parse','HEAD']).strip()
    if role=='app':
        spec=importlib.util.spec_from_file_location('catus_plan',Path(__file__).parents[2]/'catus-plan.py')
        module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
        files=run(['git','ls-files','-z']).split('\0')
        source,migration=module.fingerprints(ROOT,[x for x in files if x])
        build={s for s in module.SERVICES if not prior or prior['source_fingerprints'].get(s)!=source[s]}
        if build & module.COUPLED_SERVICES:build|=module.COUPLED_SERVICES
    elif role=='backoffice':
        files=sorted(p for p in (ROOT/'backoffice').rglob('*') if p.is_file() and 'node_modules' not in p.parts and 'dist' not in p.parts)
        source={'backoffice':hashlib.sha256(b''.join(str(p.relative_to(ROOT)).encode()+p.read_bytes() for p in files)).hexdigest()}
        migration={};build={'backoffice'} if not prior or prior.get('source_fingerprints')!=source else set()
    else:
        files=sorted((ROOT/'server/scripts/v2/prod').glob('*-V2.*'))
        source={role:hashlib.sha256(b''.join(p.name.encode()+p.read_bytes() for p in files if role in p.name)).hexdigest()}
        migration={};build=set()
    if role=='app' and pr_base:
        changed=run(['git','diff','--name-only',pr_base,revision]).splitlines()
        common=any(name.startswith(module.SHARED) or name.startswith('.github/workflows/prod-ci-V2.yml') for name in changed)
        build={service for service in module.SERVICES if common or any(name.startswith(f'server/{service}/') and not name.endswith('.md') for name in changed)}
        if build & module.COUPLED_SERVICES:build|=module.COUPLED_SERVICES
    return {'role':role,'source_revision':revision,'build_services':sorted(build),'source_fingerprints':source,'migration_fingerprints':migration,'base_release_id':prior['release_id'] if prior else None}


def read_configuration(directory,infra_revision):
    if not re.fullmatch('[0-9a-f]{40}',infra_revision):raise ValueError('Infra SHA required')
    prefix=f'configurations/{infra_revision}/'
    for name in ['configuration-V2.json','configuration-V2.zip']:
        aws('s3api','get-object','--bucket',BUCKET,'--key',prefix+name,str(directory/name))
    metadata=json.loads((directory/'configuration-V2.json').read_text())
    data=(directory/'configuration-V2.zip').read_bytes()
    if metadata.get('stack')!='V2' or metadata.get('infra_revision')!=infra_revision or hashlib.sha256(data).hexdigest()!=metadata['sha256']:
        raise ValueError('Infra configuration checksum')
    target=directory/'bundle';target.mkdir()
    with zipfile.ZipFile(directory/'configuration-V2.zip') as archive:
        if set(archive.namelist())!=set(metadata['files']):raise ValueError('Configuration file list')
        for name in archive.namelist():
            if Path(name).name!=name:raise ValueError('Configuration path')
            content=archive.read(name)
            if hashlib.sha256(content).hexdigest()!=metadata['files'][name]:raise ValueError('Configuration file checksum')
            (target/name).write_bytes(content)
    return target


def immutable_put(path,key):
    try:return aws('s3api','put-object','--bucket',BUCKET,'--key',key,'--body',str(path),'--if-none-match','*')
    except subprocess.CalledProcessError as e:
        if 'PreconditionFailed' not in (e.stderr or '') and '(412)' not in (e.stderr or ''):raise
        with tempfile.TemporaryDirectory() as d:
            old=Path(d)/'existing';result=aws('s3api','get-object','--bucket',BUCKET,'--key',key,str(old))
            if old.read_bytes()!=path.read_bytes():raise ValueError('Immutable artifact conflict')
            return result


def related_prs(plan,prior):
    repo=os.environ.get('GITHUB_REPOSITORY','OneOrThree/phone')
    paths=['.github/scripts/v2/prod/catus-runtime-V2.py']
    paths += ['backoffice'] if plan['role']=='backoffice' else ['server/scripts/v2/prod'] if plan['role'] in ['kafka','redis'] else ['server/'+service for service in plan['build_services']]
    if prior:
        revisions=run(['git','rev-list',prior['source_revision']+'..'+plan['source_revision'],'--',*paths]).splitlines()
    else:
        revisions=sorted({revision for path in paths for revision in run(['git','log','-1','--format=%H',plan['source_revision'],'--',path]).splitlines()})
    numbers=set()
    for revision in revisions:
        for item in json.loads(run(['gh','api',f'repos/{repo}/commits/{revision}/pulls'])):
            if item.get('merged_at'):numbers.add(item['number'])
    return sorted(numbers)


def on_branch(source,role):
    """source 가 역할의 배포 브랜치 중 하나에 들어 있어야 한다. 없으면 마지막 git 오류를 올린다."""
    for name in BRANCHES.get(role,('release',)):
        run(['git','fetch','origin',name,'--tags'])
        try:run(['git','merge-base','--is-ancestor',source,'origin/'+name]);return
        except subprocess.CalledProcessError as error:last=error
    raise last

def publish(args):
    info=config();prior=previous(args.role);plan=planner(args.role,prior)
    source=plan['source_revision']
    on_branch(source,args.role)
    tags=run(['git','tag','--list',PREFIX[args.role]+'-v*-V2']).splitlines()
    reserved=aws('s3api','list-objects-v2','--bucket',BUCKET,'--prefix','versions/').get('Contents',[])
    for item in reserved:
        key=item['Key']
        if key.startswith('versions/'+PREFIX[args.role]+'-v') and key.endswith('-V2.json'):
            candidate=key[len('versions/'):-len('.json')];version(candidate,args.role);tags.append(candidate)
    tags=sorted(set(tags))
    if args.version:
        tag=args.version;version(tag,args.role)
    else:
        latest=max([version(x,args.role) for x in tags],default=(1,0,-1) if args.role!='app' else (2,0,-1))
        tag=f'{PREFIX[args.role]}-v{latest[0]}.{latest[1]}.{latest[2]+1}-V2'
    git_tags=set(run(['git','tag','--list',PREFIX[args.role]+'-v*-V2']).splitlines())
    if tag in git_tags and run(['git','rev-parse',tag+'^{commit}']).strip()!=source:raise ValueError('Tag source mismatch')
    if tags:
        latest_tag=max(tags,key=lambda value:version(value,args.role))
        with tempfile.TemporaryDirectory() as history_dir:
            history=Path(history_dir)/'latest.json'
            aws('s3api','get-object','--bucket',BUCKET,'--key',f'versions/{latest_tag}.json',str(history))
            latest=json.loads(history.read_text())
            run(['git','merge-base','--is-ancestor',latest['source_revision'],source])
    images=dict(prior.get('images',{})) if prior else {}
    revisions=dict(prior.get('service_revisions',{})) if prior else {}
    service_versions=dict(prior.get('service_versions',{})) if prior else {}
    if plan['build_services']:
        password=run(['aws','ecr','get-login-password','--region',REGION]).strip()
        run(['docker','login','--username','AWS','--password-stdin','808715036056.dkr.ecr.ap-northeast-2.amazonaws.com'],input=password)
    for service in plan['build_services']:
        repository=info['IMAGE_REPOSITORIES'][service]
        local=f'{repository}:{source}-{os.environ.get("GITHUB_RUN_ID",str(time.time_ns()))}'
        path=ROOT/'backoffice' if service=='backoffice' else ROOT/'server'/service
        run(['docker','build','--platform','linux/arm64','--label',f'org.opencontainers.image.revision={source}','-t',local,str(path)],timeout=2400)
        run(['docker','push',local],timeout=1200)
        digest=aws('ecr','describe-images','--repository-name',repository.split('/',1)[1],'--image-ids','imageTag='+local.rsplit(':',1)[1])['imageDetails'][0]['imageDigest']
        images[service]=repository+'@'+digest;revisions[service]=source;service_versions[service]=tag
    release_id=source+'-'+os.environ.get('GITHUB_RUN_ID',str(time.time_ns()))+'-'+os.environ.get('GITHUB_RUN_ATTEMPT','1')
    with tempfile.TemporaryDirectory() as d:
        temp=Path(d);bundle=read_configuration(temp,args.infra_revision)
        if args.role in ['kafka','redis']:
            for file in (ROOT/'server/scripts/v2/prod').glob(args.role+'*-V2.*'):(bundle/file.name).write_bytes(file.read_bytes())
        if args.role=='app':
            for name,source_path in OBSERVABILITY_FILES.items():(bundle/name).write_bytes((ROOT/source_path).read_bytes())  # 원본이 없으면 FileNotFoundError 로 실패
        files={p.name:hashlib.sha256(p.read_bytes()).hexdigest() for p in bundle.iterdir()}
        manifest={**plan,'stack':'V2','version':tag,'infra_revision':args.infra_revision,'release_id':release_id,'images':images,'service_revisions':revisions,'service_versions':service_versions,'files':files,'related_prs':args.prs or related_prs(plan,prior)}
        (bundle/'manifest-V2.json').write_text(json.dumps(manifest,sort_keys=True))
        archive=temp/'bundle.zip'
        with zipfile.ZipFile(archive,'w',zipfile.ZIP_DEFLATED) as z:
            for p in sorted(bundle.iterdir()):z.write(p,p.name)
        key=f'releases/{release_id}/bundle.zip'
        result=immutable_put(archive,key)
        envelope={'stack':'V2','role':args.role,'version':tag,'release_id':release_id,'source_revision':source,'key':key,'object_version':result['VersionId'],'sha256':hashlib.sha256(archive.read_bytes()).hexdigest(),'manifest':manifest}
        path=temp/'release.json';path.write_text(json.dumps(envelope,sort_keys=True))
        immutable_put(path,f'versions/{tag}.json')
        if tag not in git_tags:
            run(['git','tag',tag,source]);run(['git','push','origin','refs/tags/'+tag])
        Path(args.output).write_text(json.dumps(envelope,sort_keys=True))
        print('Published '+tag)


def submit_ssm(identifier,document,params,marker,output):
    found=aws('ssm','list-commands','--instance-id',identifier,'--filters','key=DocumentName,value='+document)['Commands']
    found=[c for c in found if c.get('Comment')==marker]
    if len(found)>1:raise ValueError('Ambiguous SSM command')
    intent={'instance_id':identifier,'document':document,'parameters':params,'marker':marker}
    intent_path=Path(output+'.intent.json')
    intent_key='intents/'+hashlib.sha256(marker.encode()).hexdigest()+'-V2.json'
    with tempfile.TemporaryDirectory() as intent_dir:
        old_intent=Path(intent_dir)/'intent.json'
        try:
            aws('s3api','get-object','--bucket',BUCKET,'--key',intent_key,str(old_intent))
            prior_intent=json.loads(old_intent.read_text())
        except subprocess.CalledProcessError as error:
            if 'NoSuchKey' not in (error.stderr or '') and '(404)' not in (error.stderr or ''):raise
            prior_intent=None
    if prior_intent and prior_intent!=intent:raise ValueError('Persisted SSM intent changed')
    intent_path.write_text(json.dumps(intent,sort_keys=True))
    command_id=None
    if found:
        if found[0].get('Parameters')!=params or found[0].get('InstanceIds')!=[identifier]:raise ValueError('SSM request changed')
        command_id=found[0]['CommandId']
    elif not prior_intent:
        immutable_put(intent_path,intent_key)
        try:
            command_id=aws('ssm','send-command','--document-name',document,'--instance-ids',identifier,'--parameters',json.dumps(params),'--comment',marker)['Command']['CommandId']
        except (subprocess.CalledProcessError,subprocess.TimeoutExpired):
            pass
    if command_id is None:
        deadline=time.monotonic()+120
        while time.monotonic()<deadline:
            candidates=aws('ssm','list-commands','--instance-id',identifier,'--filters','key=DocumentName,value='+document)['Commands']
            matches=[item for item in candidates if item.get('Comment')==marker]
            if len(matches)>1:raise ValueError('Ambiguous SSM recovery')
            if matches:
                if matches[0].get('Parameters')!=params or matches[0].get('InstanceIds')!=[identifier]:raise ValueError('SSM recovery mismatch')
                command_id=matches[0]['CommandId'];break
            time.sleep(5)
        if command_id is None:raise RuntimeError('Unconfirmed SSM request; inspect persisted intent before a new run')
    return command_id


def ssm_params(envelope,rollback,allow_migration):
    """SSM 배포 파라미터. AllowMigration 은 승인한 DB 전환 배포에만 실어 Infra 문서 기본값(false)을 그대로 쓰게 한다."""
    params={'ReleaseKey':[envelope['key']],'ObjectVersion':[envelope['object_version']],'BundleSha256':[envelope['sha256']],'Rollback':['true' if rollback else 'false']}
    if allow_migration:params['AllowMigration']=['true']
    return params


def deploy(args):
    # 승인은 앱 역할의 정방향 DB 전환에만 쓴다. 조회·전송 전에 거부해 아무것도 건드리지 않는다.
    if getattr(args,'allow_migration',False):
        if getattr(args,'rollback',False):raise ValueError('allow_migration cannot be combined with rollback')
        if args.role!='app':raise ValueError('allow_migration is only for the app role')
    info=config();version(args.version,args.role)
    names=BRANCHES.get(args.role,('release',))
    if os.environ.get('GITHUB_REF') and os.environ['GITHUB_REF'] not in ['refs/heads/'+n for n in names]:raise ValueError('/'.join(names)+' branch required')
    with tempfile.TemporaryDirectory() as d:
        path=Path(d)/'release.json';aws('s3api','get-object','--bucket',BUCKET,'--key',f'versions/{args.version}.json',str(path))
        envelope=json.loads(path.read_text())
    if envelope.get('stack')!='V2' or envelope.get('role')!=args.role or envelope.get('version')!=args.version:raise ValueError('Release mismatch')
    on_branch(envelope['source_revision'],args.role)
    if run(['git','rev-parse',args.version+'^{commit}']).strip()!=envelope['source_revision']:raise ValueError('Moved release tag')
    if args.role=='redis':
        target=info['INSTANCE_IDS']['app']
        projection_marker='catus-V2:redis-projection:'+os.environ.get('GITHUB_RUN_ID',envelope['release_id'])
        projection=submit_ssm(target,info['REDIS_PROJECTION_DOCUMENT'],{},projection_marker,args.output+'.projection')
        deadline=time.monotonic()+240
        while time.monotonic()<deadline:
            try:result=aws('ssm','get-command-invocation','--command-id',projection,'--instance-id',target)
            except subprocess.CalledProcessError as error:
                if 'InvocationDoesNotExist' not in (error.stderr or ''):raise
                time.sleep(3);continue
            if result['Status']=='Success':break
            if result['Status'] in ['Failed','TimedOut','Cancelled']:raise RuntimeError('Redis credentials projection failed')
            time.sleep(3)
        else:raise TimeoutError('Redis credentials projection timeout')
    identifier=info['INSTANCE_IDS'][args.role];document=info['SSM_DOCUMENTS'][args.role]
    params=ssm_params(envelope,args.rollback,args.allow_migration)
    marker='catus-V2:'+args.role+':'+os.environ.get('GITHUB_RUN_ID',envelope['release_id'])
    command_id=submit_ssm(identifier,document,params,marker,args.output)
    print('SSM '+command_id,flush=True)
    deadline=time.monotonic()+2450
    status='Pending'
    while time.monotonic()<deadline:
        try:result=aws('ssm','get-command-invocation','--command-id',command_id,'--instance-id',identifier)
        except subprocess.CalledProcessError as e:
            if 'InvocationDoesNotExist' not in (e.stderr or ''):raise
            time.sleep(3);continue
        status=result['Status']
        if status in ['Success','Failed','TimedOut','Cancelled']:
            record={'stack':'V2','role':args.role,'version':args.version,'status':status,'command_id':command_id,'release':envelope,'run_url':os.environ.get('RUN_URL','')}
            Path(args.output).write_text(json.dumps(record,sort_keys=True))
            if status!='Success':
                print(result.get('StandardOutputContent','')[-1500:]);print(result.get('StandardErrorContent','')[-1500:]);raise RuntimeError('Deployment '+status)
            print('Deployment successful: '+args.version);return
        time.sleep(5)
    raise TimeoutError('SSM command still running; inspect command '+command_id)


def record(args):
    result=json.loads(Path(args.input).read_text());role=result['role']
    if result.get('stack')!='V2' or role not in ROLES:raise ValueError('Invalid deployment result')
    tag=result['version'];version(tag,role)
    repo=os.environ.get('GITHUB_REPOSITORY','OneOrThree/phone')
    status='배포 성공' if result['status']=='Success' else '배포 실패'
    marker=f'<!-- catus-deployment-prod-{role}-V2 -->'
    body=f'{marker}\nprod {role} V2: **{status}** · [{tag}](https://github.com/{repo}/releases/tag/{tag})\n\n[실행 기록]({result.get("run_url","")}) · SSM `{result["command_id"]}`'
    for number in result['release']['manifest'].get('related_prs',[]):
        if not isinstance(number,int):raise ValueError('PR number required')
        comments=json.loads(run(['gh','api',f'repos/{repo}/issues/{number}/comments','--paginate','--slurp']))
        comments=[c for page in comments for c in page]
        existing=next((c for c in comments if marker in c.get('body','') and (c.get('user',{}).get('type')=='Bot' or c.get('user',{}).get('login')==os.environ.get('GITHUB_ACTOR'))),None)
        with tempfile.NamedTemporaryFile('w',suffix='.json') as f:
            json.dump({'body':body},f);f.flush()
            path=f'repos/{repo}/issues/comments/{existing["id"]}' if existing else f'repos/{repo}/issues/{number}/comments'
            run(['gh','api','--method','PATCH' if existing else 'POST',path,'--input',f.name])
    publish_badge(result,repo)


def publish_badge(result,repo):
    for attempt in range(8):
        try:return publish_badge_once(result,repo)
        except subprocess.CalledProcessError as error:
            detail=error.stderr or ''
            if attempt==7 or not any(code in detail for code in ['HTTP 409','HTTP 422','not a fast forward','is not a fast forward']):raise
            time.sleep(min(2**attempt,15))


def publish_badge_once(result,repo):
    branch='deployment-status'
    head=json.loads(run(['gh','api',f'repos/{repo}/git/ref/heads/{branch}']))['object']['sha']
    tree=json.loads(run(['gh','api',f'repos/{repo}/git/commits/{head}']))['tree']['sha']
    role=result['role'];success=result['status']=='Success'
    paths=[(f'prod-V2/{role}-attempt.json',{'schemaVersion':1,'label':role+' V2 attempt','message':result['status'],'color':'green' if success else 'red'})]
    if success:
        paths.append((f'prod-V2/{role}.json',{'schemaVersion':1,'label':role+' prod V2','message':result['version'],'color':'green','namedLogo':'amazonaws'}))
        if role=='app':
            for service,revision in result['release']['manifest']['service_revisions'].items():
                paths.append((f'prod-V2/{service}.json',{'schemaVersion':1,'label':service+' prod V2','message':result['release']['manifest'].get('service_versions',{}).get(service,revision[:8]),'color':'green'}))
    changes=[{'path':path,'mode':'100644','type':'blob','content':json.dumps(value)} for path,value in paths]
    def post(path,payload):
        with tempfile.NamedTemporaryFile('w',suffix='.json') as f:
            json.dump(payload,f);f.flush();return json.loads(run(['gh','api','--method','POST',path,'--input',f.name]))
    new_tree=post(f'repos/{repo}/git/trees',{'base_tree':tree,'tree':changes})['sha']
    commit=post(f'repos/{repo}/git/commits',{'message':f'[CHORE] GROMO-2288 {role} V2 운영 배포 상태 기록','tree':new_tree,'parents':[head]})['sha']
    with tempfile.NamedTemporaryFile('w',suffix='.json') as f:
        json.dump({'sha':commit,'force':False},f);f.flush();run(['gh','api','--method','PATCH',f'repos/{repo}/git/refs/heads/{branch}','--input',f.name])


def main():
    p=argparse.ArgumentParser();sub=p.add_subparsers(dest='command',required=True)
    plan=sub.add_parser('plan');plan.add_argument('--role',choices=ROLES,required=True);plan.add_argument('--output',default='plan-V2.json');plan.add_argument('--production',action='store_true');plan.add_argument('--pr-base')
    pub=sub.add_parser('publish');pub.add_argument('--role',choices=ROLES,required=True);pub.add_argument('--version');pub.add_argument('--infra-revision',required=True);pub.add_argument('--output',default='release-V2.json');pub.add_argument('--prs',nargs='*',type=int)
    dep=sub.add_parser('deploy');dep.add_argument('--role',choices=ROLES,required=True);dep.add_argument('--version',required=True);dep.add_argument('--output',default='deployment-V2.json');dep.add_argument('--rollback',action='store_true');dep.add_argument('--allow-migration',action='store_true')
    rec=sub.add_parser('record');rec.add_argument('--input',required=True)
    args=p.parse_args()
    if args.command=='plan':
        result=planner(args.role,previous(args.role) if args.production else None,args.pr_base);Path(args.output).write_text(json.dumps(result,sort_keys=True))
        if os.environ.get('GITHUB_OUTPUT'):
            with open(os.environ['GITHUB_OUTPUT'],'a') as f:f.write('matrix='+json.dumps({'service':result['build_services']})+'\n')
    elif args.command=='publish':publish(args)
    elif args.command=='deploy':deploy(args)
    else:record(args)

if __name__=='__main__':main()
