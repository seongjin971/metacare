# 복약 공유 테스트 서버

Vercel에는 메타케어의 두 역할이 사용하는 `/v1` API를 배포합니다. 각 휴대폰은 같은 앱을 설치하고 고정 HTTPS 주소로 같은 서버에 접속합니다. 테스트 환경에는 시연 자료만 사용하세요.

통합 앱의 EAS `preview` 프로필은 `https://metacare-sharing-test.vercel.app`을 사용합니다. [테스트 서버 상태 확인](https://metacare-sharing-test.vercel.app/v1/health). `production` 프로필도 같은 HTTPS 서버로 연결합니다.

## 배포

1. 저장소 루트를 Vercel 프로젝트에 연결합니다. `vercel.json`이 API 라우팅, 함수 리전, 빌드 명령을 정의합니다. 웹 프레임워크 프리셋은 **Other**입니다.
2. 프로젝트의 테스트 배포 환경에 전용 비공개 PostgreSQL을 연결합니다. Neon을 쓰면 통합이 제공하는 풀링된 `DATABASE_URL`을 **서버 환경 변수**로 사용합니다. 데이터베이스 소유자 역할이 최초 테이블을 생성할 수 있어야 합니다.
3. `vercel deploy --prod`로 **테스트 프로젝트의 고정 도메인**을 배포합니다. 빌드 중 `npm run care:migrate`가 데이터베이스에 테이블을 준비합니다. 재배포는 같은 데이터베이스를 유지합니다. `GET /v1/health`는 준비 완료 시 `{"status":"ok"}`를 반환합니다.
4. 저장소 루트의 통합 앱 빌드에서 고정 도메인을 `EXPO_PUBLIC_CARE_URL`로 지정합니다. 값은 `https://호스트` 형태의 기본 주소이며 끝에 `/v1`을 붙이지 않습니다. 환경 변수를 바꾸면 새 클라이언트 번들이 필요합니다. 새 서버에서는 환자가 공유에 동의하고 보호자를 다시 연결합니다.

공개 웹 미리보기의 두 주소는 API 프로젝트의 `CARE_WEB_PREVIEW_ORIGINS`에 쉼표로 구분하여 설정합니다. 배포 서버는 등록된 HTTPS 도메인의 정확한 출처만 허용합니다(예: `https://metacare-patient-test.vercel.app`). 다른 배포 도메인은 `CARE_ALLOWED_ORIGINS`에 추가한 뒤 API를 재배포하세요. PC에서 실행한 웹 미리보기는 로컬 공유 서버를 사용합니다. 네이티브 앱에는 브라우저 CORS 설정이 필요하지 않습니다.

## 웹 미리보기 배포

저장소 루트에서 `npm run export:public-web`을 실행합니다. 같은 앱을 한 번 빌드해서 기존 환자·보호자 주소의 배포 폴더에 복제합니다. 주소를 강제로 돌리지 않으므로 각 주소의 기존 환자·보호자 연결이 유지됩니다. 기본 공유 API는 `https://metacare-sharing-test.vercel.app`이며, 다른 테스트 서버는 빌드 전에 `EXPO_PUBLIC_CARE_URL`로 지정합니다.

처음 배포하는 PC에서는 각 출력 폴더를 해당 프런트엔드 프로젝트에 `vercel link`로 연결합니다. 이후에는 다음 명령으로 두 주소에 배포합니다.

```powershell
vercel deploy --prebuilt --prod --cwd .preview/public-web/patient
vercel deploy --prebuilt --prod --cwd .preview/public-web/caregiver
```

## 기록과 사진

연결 코드, 기기별 접근 권한과 복약 기록은 PostgreSQL에 보관합니다. 사진도 같은 비공개 데이터베이스에 저장하며, 보호자에게 사진을 공개 URL로 제공하지 않습니다. 최대 5 MiB 사진은 인증된 요청 최대 두 번으로 전송합니다. 환자와의 연결 해제 또는 사진 참조 삭제 시 완성된 사진과 전송 중인 조각을 정리합니다.

로컬 회귀 검증에는 별도의 빈 테스트 PostgreSQL을 사용합니다. `TEST_DATABASE_URL`을 그 데이터베이스로 지정하고 `npm test`를 실행하면 클라우드용 핸들러와 실제 PostgreSQL을 함께 검사합니다. 운영 데이터베이스를 테스트에 사용하지 마세요.

## 보호자 미기록 알림

보호자가 **관리 → 미기록 알림 받기**를 켜면, 서버가 환자의 복약 시각마다 확인 작업을 [Vercel Queues](https://vercel.com/docs/queues)에 예약합니다. 기한(예정 시각 + 보호자가 고른 15분·30분·1시간·2시간)에 서버에 기록이 없으면 보호자 휴대폰에 회차당 한 번 푸시를 보냅니다.

- **잠금화면 문구:** 약 이름·시간 없이 "메타케어 · 확인할 복약 기록이 있어요"만 표시합니다. 알림을 누르면 앱에서 그날 기록이 열립니다.
- **중복 방지:** 같은 회차는 한 번만 보냅니다. 전송 결과가 불분명하면 다시 보내지 않습니다.
- **알림의 의미:** 서버에 기록이 도착하지 않았다는 뜻이며, 실제 미복용을 뜻하지 않습니다.
- **해제:** 연결을 해제하거나 보호자 기기가 역할을 바꾸면 해당 기기의 알림이 꺼집니다.

푸시는 Expo 푸시 서비스를 거쳐 Android에서는 FCM으로 전달됩니다. 설치 앱(APK)에서만 동작하고 Expo Go·웹에서는 켤 수 없습니다. 처음 한 번 아래 설정이 필요합니다.

1. [Firebase 콘솔](https://console.firebase.google.com/)에서 프로젝트를 만들고, 패키지 이름 `com.metacare.demo`로 Android 앱을 추가한 뒤 `google-services.json`을 내려받습니다. 이 파일은 저장소에 커밋하지 않습니다(`.gitignore`에 포함).
2. 그 파일을 EAS의 **파일 환경 변수** `METACARE_GOOGLE_SERVICES_FILE`로 등록합니다. `app.config.js`가 빌드 시 이 값을 `android.googleServicesFile`로 사용합니다.

   ```powershell
   npx eas-cli env:create --name METACARE_GOOGLE_SERVICES_FILE --type file --value ./google-services.json --environment preview --environment production
   ```

3. Firebase 콘솔 → 프로젝트 설정 → 서비스 계정에서 **FCM V1용 비공개 키(JSON)**를 만들고 `npx eas-cli credentials` → Android → Push Notifications (FCM V1)에 업로드합니다. 비공개 키는 소스·앱 번들·채팅에 넣지 마세요. [Expo FCM 설정](https://docs.expo.dev/push-notifications/fcm-credentials/)
4. Expo 계정에서 Push Security를 켠 경우에만 API 프로젝트의 서버 환경 변수에 `EXPO_ACCESS_TOKEN`을 추가합니다.
5. API를 재배포합니다. 빌드 중 마이그레이션이 알림 테이블을 준비하고, 11월 3일 알림 중지 때 넣은 제약을 해제합니다. 그 다음 새 APK를 빌드합니다.

로컬 공유 서버(`npm run care:server`)도 같은 규칙으로 타이머를 돌려 Expo 푸시를 보냅니다. 서버가 켜져 있어야 발송되며, 등록 정보는 `server/data/care.json`에 저장됩니다.
