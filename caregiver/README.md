# 메타케어 보호자

환자 앱과 별도로 설치하는 Expo SDK 58 앱입니다. Android 패키지와 iOS 번들 ID는 `com.metacare.caregiver`이며 보호자 전용 EAS 프로젝트 `kwaksungjins-team/metacare-caregiver`를 사용합니다.

## 휴대폰에서 열기

1. [환자 앱의 내 관리](https://metacare-patient-test.vercel.app/settings)에서 복약 기록 공유에 동의하고 8자리 초대 코드를 만듭니다.
2. [보호자 앱](https://metacare-caregiver-test.vercel.app/)에 코드를 입력합니다. 코드는 10분 동안 한 번만 사용할 수 있습니다. **예시로 살펴보기**를 누르면 연결하지 않고도 예시 기록을 볼 수 있습니다.

## 개발 PC에서 로컬로 실행하기

상위 `mobile` 폴더에서 다음 명령을 실행합니다.

```powershell
npm ci
node scripts/caregiver-preview.cjs
```

개발 PC에서만 쓰는 주소는 환자 앱 `http://localhost:8081/settings`, 보호자 앱 `http://localhost:8082/`, 공유 API `http://127.0.0.1:8789`입니다.

## 구현과 한계

- 오늘: 확인이 필요한 미기록을 먼저 표시하고, 예정·기록 대기·기록됨을 구분합니다. 환자가 별도로 허용한 경우 가장 가까운 진료의 병원명·날짜·시간을 표시합니다. 다음 진료는 보호자 기기의 오프라인 캐시에 보관하지 않습니다.
- 기록: 월간 캘린더, 날짜별 기록, 권한이 있는 공유 사진 조회.
- 관리: 환자 별명, 연락처, 15/30/60/120분 미기록 표시 기준, 연결 해제.
- 기록·일정 최근 90일 최대 300개, 사진 최대 30장·장당 5MiB. 사진 파일이 아직 전송되지 않았거나 용량이 크면 기록만 먼저 표시하고 사진 조회 실패를 안내합니다.
- 보호자는 공유 데이터를 수정할 수 없습니다. 전화 버튼은 등록한 번호의 전화 앱을 여는 동작이며, 앱에서 직접 전화를 발신하거나 메시지를 보내지 않습니다.
- 환자 전송·보호자 조회는 전경에서 수행합니다. 마지막 수신 시각과 환자 갱신 시각을 구분하며, 오래된 캐시는 최신으로 표시하지 않습니다.
- 환자와 연결한 뒤 **관리 → 미기록 알림 받기**를 켜고 알림을 허용하세요. 정한 대기 시간까지 공유 서버에 기록이 없으면 회차당 한 번 알립니다. 알림을 누르면 해당 날짜의 기록이 열립니다. 미기록은 복용하지 않았다는 뜻이 아닙니다.
- 웹 알림은 보호자 화면을 닫아도 동작합니다. Android에서는 Chrome, Windows에서는 Edge·Chrome을 사용할 수 있습니다. iPhone/iPad에서는 Safari에서 **홈 화면에 추가**한 뒤 그 아이콘으로 열어 알림을 켜세요(iOS/iPadOS 16.4 이상). 다른 기기에서 알림을 켜면 새 기기가 받습니다. 예시 모드와 Expo Go에서는 푸시를 등록하지 않습니다.
- PC 미리보기는 로컬 서버를, 휴대폰 테스트는 Vercel API와 비공개 PostgreSQL을 사용합니다. 환자 앱과 같은 HTTPS 주소로 설정합니다. [원격 테스트 환경](../server/VERCEL.md)
- 환자의 사진 판별은 기존 네이티브 모듈이 필요합니다. 웹/Expo Go에서는 새 사진 인증을 완료할 수 없습니다.

공통 UI·모션·달력은 상위 `src`를 재사용하고, 최소 공유 형식·통신·기기 인증 저장은 상위 `shared`에 있습니다. 공유 서버는 `server/care-server.ts`이며 기록 파일은 git/EAS 업로드에서 제외합니다.

Android 푸시 빌드에는 보호자 패키지로 등록한 Firebase Android 앱의 `google-services.json` 파일이 필요합니다. 빌드 환경의 파일 변수 `CAREGIVER_GOOGLE_SERVICES_FILE`에 설정하고, 같은 Firebase 프로젝트의 FCM v1 서비스 계정을 보호자 EAS 프로젝트의 Android 푸시 자격 증명에 등록합니다. iOS는 해당 번들 ID의 APNs 키를 설정합니다. [Expo 푸시 설정](https://docs.expo.dev/push-notifications/push-notifications-setup/)

## 검증

2026-11-01: 전체 테스트 95개, 환자·보호자 타입 검사와 린트 통과. 보호자 Android JavaScript 번들 export 성공(APK 빌드 아님). 브라우저의 별도 합성 환자 저장소에서 코드 생성→보호자 연결→환자 복약 횟수 변경 반영→보호자 설정 저장·재실행 유지를 확인했습니다. 공유 서버를 중단한 상태에서 환자가 연결 해제를 선택하면 새 공유를 중지하고, 환자 앱을 다시 열어도 해제 대기 상태가 유지됩니다. 서버 재시작 후 자동 해제와 보호자 화면의 기존 자료 제거를 확인했습니다. 별도 합성 이미지(앱 아이콘)로 보호된 사진 API의 실제 표시와, 사진창을 연 상태에서 권한이 해제될 때 사진·기록 화면이 사라지는 것도 확인했습니다. 실환자 자료는 사용하지 않았습니다.

상위 `mobile` 폴더에서:

```powershell
npm test
npm run typecheck
npm run caregiver:typecheck
npm run lint
npm run lint --workspace @metacare/caregiver
```

설치 파일을 만들기 전 Android/iPhone 실기기에서 최초 연결, 동의 철회, 오프라인 복구, 카메라 파일 전송과 전화 앱 이동을 추가 확인해야 합니다.
