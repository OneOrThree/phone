#!/usr/bin/env python3
"""설치된 Gradle 캐시의 컴파일러로 실제 저장소 코드를 JVM에서 검증한다."""
import glob
import os
from pathlib import Path
import subprocess
import shutil

module = Path(__file__).resolve().parent.parent
os.chdir(module)
build = module / 'tests/.build'
build.mkdir(exist_ok=True)
cache = Path.home() / '.gradle/caches/modules-2/files-2.1'

def jar(group, artifact, version):
    files = glob.glob(str(cache / group / artifact / version / '*' / '*.jar'))
    return next(path for path in files if not path.endswith(('-sources.jar', '-javadoc.jar')))

stdlib = jar('org.jetbrains.kotlin', 'kotlin-stdlib', '2.2.0')
annotations = jar('org.jetbrains', 'annotations', '23.0.0')
compiler = [jar('org.jetbrains.kotlin', a, '2.2.0') for a in ['kotlin-compiler-embeddable', 'kotlin-script-runtime', 'kotlin-daemon-embeddable']]
compiler += [stdlib, annotations, jar('org.jetbrains.kotlinx', 'kotlinx-coroutines-core-jvm', '1.8.0')]
# compiler 배포본의 reflect 버전은 별도로 제공된다.
compiler += [jar('org.jetbrains.kotlin', 'kotlin-reflect', '1.6.10')]
classpath = [stdlib, annotations, jar('com.squareup.okhttp3', 'okhttp', '4.9.2'), jar('com.squareup.okio', 'okio', '2.9.0'), jar('junit', 'junit', '4.13.2'), jar('org.hamcrest', 'hamcrest-core', '1.3')]
java = str(Path(os.environ['JAVA_HOME']) / 'bin/java') if os.environ.get('JAVA_HOME') else shutil.which('java')
if not java:
    raise SystemExit('JAVA_HOME 또는 PATH에 JDK가 필요합니다.')
source = module / 'android/src/main/java/com/oneorthree/catusassetcache/AssetCacheStore.kt'
tests = module / 'android/src/test/java/com/oneorthree/catusassetcache/AssetCacheStoreTest.kt'
subprocess.run([java, '-cp', ':'.join(compiler), 'org.jetbrains.kotlin.cli.jvm.K2JVMCompiler', '-no-stdlib', '-no-reflect', '-jvm-target', '17', '-classpath', ':'.join(classpath), '-d', str(build / 'kotlin-tests.jar'), str(source), str(tests)], check=True)
subprocess.run([java, '-cp', ':'.join([str(build / 'kotlin-tests.jar')] + classpath), 'org.junit.runner.JUnitCore', 'com.oneorthree.catusassetcache.AssetCacheStoreTest'], check=True)
