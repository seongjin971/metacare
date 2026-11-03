# 복약 공유 테스트 서버

Vercel에는 두 앱이 호출하는 `/v1` API를 배포합니다. 각 휴대폰은 자기 기기에서 앱을 실행하고, 고정 HTTPS 주소로 같은 서버에 접속합니다. 테스트 환경에는 시연 자료만 사용하세요.

현재 두 앱의 EAS `preview` 프로필은 `https://metacare-sharing-test.vercel.app`을 사용합니다. [테스트 서버 상태 확인](https://metacare-sharing-test.vercel.app/v1/health). `production` 빌드의 주소는 배포 환경에서 별도로 설정합니다.

## 배포

1. 저장소 루트를 Vercel 프로젝트에 연결합니다. `vercel.json`이 API 라우팅, 함수 리전, 빌드 명령을 정의합니다. 웹 프레임워크 프리셋은 **Other**입니다.
2. 프로젝트의 테스트 배포 환경에 전용 비공개 PostgreSQL을 연결합니다. Neon을 쓰면 통합이 제공하는 풀링된 `DATABASE_URL`을 **서버 환경 변수**로 사용합니다. 데이터베이스 소유자 역할이 최초 테이블을 생성할 수 있어야 합니다.
3. `vercel deploy --prod`로 **테스트 프로젝트의 고정 도메인**을 배포합니다. 빌드 중 `npm run care:migrate`가 데이터베이스에 테이블을 준비합니다. 재배포는 같은 데이터베이스를 유지합니다. `GET /v1/health`는 준비 완료 시 `{"status":"ok"}`를 반환합니다.
4. 환자 앱과 보호자 앱의 테스트 빌드에 같은 고정 도메인을 `EXPO_PUBLIC_CARE_URL`로 지정합니다. 값은 `https://호스트` 형태의 기본 주소이며 끝에 `/v1`을 붙이지 않습니다. EAS에서 두 앱은 별도 프로젝트입니다. 환경 변수를 바꾼 후에는 새 클라이언트 번들이 필요합니다. 새 서버에서는 환자가 공유에 동의하고 보호자를 다시 연결합니다.

공개 웹 미리보기의 두 주소는 API 프로젝트의 `CARE_WEB_PREVIEW_ORIGINS`에 쉼표로 구분하여 설정합니다. 각 주소는 스킴과 호스트까지만 입력합니다. 다른 허용 주소는 기존 `CARE_ALLOWED_ORIGINS`에서 별도로 관리합니다. 변경 후 API를 재배포하세요. 네이티브 앱에는 브라우저 CORS 설정이 필요하지 않습니다.

## 웹 미리보기 배포

저장소 루트에서 `npm run export:public-web`을 실행합니다. 환자용과 보호자용 웹 페이지를 각 폴더의 `.vercel/output`에 생성합니다. 기본 공유 API는 `https://metacare-sharing-test.vercel.app`이며, 다른 테스트 서버는 빌드 전에 `EXPO_PUBLIC_CARE_URL`로 지정합니다.

처음 배포하는 PC에서는 각 출력 폴더를 해당 프런트엔드 프로젝트에 `vercel link`로 연결합니다. 이후에는 다음 명령으로 두 앱을 배포합니다.

```powershell
vercel deploy --prebuilt --prod --cwd .preview/public-web/patient
vercel deploy --prebuilt --prod --cwd .preview/public-web/caregiver
```

## 기록과 사진

연결 코드, 기기별 접근 권한과 복약 기록은 PostgreSQL에 보관합니다. 사진도 같은 비공개 데이터베이스에 저장하며, 보호자에게 사진을 공개 URL로 제공하지 않습니다. 최대 5 MiB 사진은 인증된 요청 최대 두 번으로 전송합니다. 환자와의 연결 해제 또는 사진 참조 삭제 시 완성된 사진과 전송 중인 조각을 정리합니다.

로컬 회귀 검증에는 별도의 빈 테스트 PostgreSQL을 사용합니다. `TEST_DATABASE_URL`을 그 데이터베이스로 지정하고 `npm test`를 실행하면 클라우드용 핸들러와 실제 PostgreSQL을 함께 검사합니다. 운영 데이터베이스를 테스트에 사용하지 마세요.

## 보호자의 미기록 알림

보호자 앱에서 알림을 허용하고 15분·30분·1시간·2시간 중 하나를 선택합니다. 서버는 환자의 복약 시간대에 맞춰 다음 회차를 Vercel Queues에 예약합니다. 기한에 서버에 도착한 기록, 현재 연결, 알림 설정을 다시 확인합니다. 알림 내용은 실제 미복용이 아니라 **서버에 기록이 없음**을 의미합니다. 같은 회차는 발송 대상으로 한 번만 처리합니다. 전송 결과가 불분명하면 중복 발송하지 않습니다.

안드로이드 설치본에는 보호자 EAS 프로젝트의 FCM V1 발송 자격 증명과 `com.metacare.caregiver`에 맞는 Firebase 앱 설정이 필요합니다. EAS의 빌드 환경에서 `CAREGIVER_GOOGLE_SERVICES_FILE`을 **파일 환경 변수**로 지정하세요. FCM 서비스 계정 비공개 키는 소스나 앱 번들에 넣지 말고 EAS 자격 증명에 등록하세요. [Expo FCM 설정](https://docs.expo.dev/push-notifications/fcm-credentials/). Expo Push Security를 켠 경우에만 서버 환경에 `EXPO_ACCESS_TOKEN`도 설정합니다. iOS 설치본에는 해당 앱의 APNs 자격 증명이 필요합니다.

수신 검증은 알림 권한을 허용한 설치본에서 합니다(Android Expo Go·브라우저 제외). 알림을 켠 뒤 앱을 최근 목록에서 닫고 미기록 회차와 기한 전에 기록한 회차를 각각 확인하세요. 안드로이드 시스템 설정의 ‘강제 종료’는 다시 앱을 열 때까지 푸시 수신을 막습니다.
