# FRED_Exchange

미국 연방준비제도이사회(Federal Reserve Board)의 H.10 환율 자료를 FRED에서 받아 일별, 월평균, 연평균 CSV로 저장하는 저장소입니다. GitHub Actions가 새 자료 공표에 맞추어 자동으로 갱신합니다.

*Daily H.10 foreign exchange rates from FRED, with monthly and annual averages, updated automatically by GitHub Actions.*

## 데이터 파일

| 파일 | 내용 | 열 이름 |
|---|---|---|
| `data/daily.csv` | 일별 환율과 달러지수, FRED 공표 단위 그대로 | FRED 시리즈 ID (`DEXKOUS` 등) |
| `data/daily_per_usd.csv` | 일별 환율, 모든 통화를 미 달러 1단위당 외화로 통일 | ISO 통화 코드 (`KRW` 등) |
| `data/monthly.csv` | `daily.csv`의 월평균 | `month`, `partial`, 시리즈 ID |
| `data/monthly_per_usd.csv` | `daily_per_usd.csv`의 월평균 | `month`, `partial`, 통화 코드 |
| `data/annual.csv` | `daily.csv`의 연평균 | `year`, `partial`, 시리즈 ID |
| `data/annual_per_usd.csv` | `daily_per_usd.csv`의 연평균 | `year`, `partial`, 통화 코드 |
| `data/metadata.json` | 갱신 시각, 마지막 관측일, 시리즈별 관측 기간과 관측치 수 | |
| `config/series.csv` | 수집 대상 시리즈 목록과 단위 | |

모든 시리즈는 각 시리즈의 첫 관측일(1971년 이후)부터 전체 기간을 담습니다.

## 표기 방향

FRED 원자료는 대부분 미 달러 1단위당 외화로 표기합니다(`DEXKOUS`는 원/달러). 다만 호주 달러(`DEXUSAL`), 유로(`DEXUSEU`), 뉴질랜드 달러(`DEXUSNZ`), 영국 파운드(`DEXUSUK`) 4개는 외화 1단위당 미 달러로 표기합니다.

`*_per_usd.csv` 파일은 이 4개 통화를 역수로 바꾸어 모든 통화를 미 달러 1단위당 외화 단위로 맞춘 것입니다. 역수 값은 소수점 6자리로 반올림합니다. 달러지수 3종은 환율이 아니므로 원자료 파일(`daily.csv`, `monthly.csv`, `annual.csv`)에만 들어 있습니다.

## 수록 시리즈

| 코드 | 국가·지역 | FRED ID | 코드 | 국가·지역 | FRED ID |
|---|---|---|---|---|---|
| AUD | 호주 | DEXUSAL | MXN | 멕시코 | DEXMXUS |
| BRL | 브라질 | DEXBZUS | NZD | 뉴질랜드 | DEXUSNZ |
| CAD | 캐나다 | DEXCAUS | NOK | 노르웨이 | DEXNOUS |
| CNY | 중국 | DEXCHUS | SGD | 싱가포르 | DEXSIUS |
| DKK | 덴마크 | DEXDNUS | ZAR | 남아프리카공화국 | DEXSFUS |
| EUR | 유로 지역 | DEXUSEU | LKR | 스리랑카 | DEXSLUS |
| HKD | 홍콩 | DEXHKUS | SEK | 스웨덴 | DEXSDUS |
| INR | 인도 | DEXINUS | CHF | 스위스 | DEXSZUS |
| JPY | 일본 | DEXJPUS | TWD | 대만 | DEXTAUS |
| KRW | 한국 | DEXKOUS | THB | 태국 | DEXTHUS |
| MYR | 말레이시아 | DEXMAUS | GBP | 영국 | DEXUSUK |

달러지수는 `DTWEXBGS`(Broad), `DTWEXAFEGS`(선진국 통화), `DTWEXEMEGS`(신흥국 통화) 3종이며 모두 2006년 1월=100 기준입니다.

베네수엘라(`DEXVZUS`)는 H.10 표에 있으나 화폐 단위 변경이 여러 차례 있었기 때문에 기본 목록에서 제외했습니다.

## 집계 방법

- 월평균과 연평균은 해당 기간에 관측된 일별 값의 단순평균입니다. Fed가 공표하는 공식 월평균(G.5), 연평균(G.5A)과는 반올림 등에서 작은 차이가 있을 수 있습니다.
- `*_per_usd` 평균은 역수로 바꾼 일별 값의 평균입니다. 원자료 평균의 역수와는 값이 조금 다를 수 있습니다.
- `partial` 열이 `True`이면 그 기간의 마지막 평일 자료가 아직 들어오지 않은 상태(진행 중인 달이나 연도)입니다.
- 미국 공휴일처럼 모든 시리즈가 비어 있는 날짜는 일별 파일에서 제외합니다. 일부 통화만 비어 있는 날은 해당 칸을 빈칸으로 둡니다.

## 자동 갱신

H.10 일별 자료는 매주 월요일 오후 4시 15분(미국 동부시간)에 직전 주 자료가 공표되며, 월요일이 연방 공휴일이면 다음 영업일에 공표됩니다.

워크플로(`.github/workflows/update-fx.yml`)는 화요일부터 토요일까지 매일 09시 17분(한국시간)에 실행되고, 새 값이 있을 때만 커밋합니다. 실제 커밋은 대개 주 1회 생깁니다.

- 수동 실행은 Actions 탭에서 **Update FX data** 선택 후 **Run workflow**를 누르면 됩니다.
- 내려받은 자료의 관측치 수가 기존보다 줄어들면 불완전한 다운로드로 보고 아무것도 저장하지 않은 채 실패 처리합니다. 이때 GitHub이 저장소 소유자에게 알림을 보냅니다.
- 공개 저장소에서 60일 동안 활동이 없으면 GitHub이 예약 실행을 멈출 수 있습니다. 이 경우 Actions 탭에서 다시 활성화하면 됩니다.

## FRED API 키 (권장)

API 키가 없어도 FRED의 공개 CSV 다운로드(`fredgraph.csv`)로 동작합니다. 공식 API를 쓰면 응답이 더 안정적이므로 키 등록을 권장합니다.

1. https://fred.stlouisfed.org/docs/api/api_key.html 에서 무료 키를 발급받습니다.
2. 저장소 **Settings > Secrets and variables > Actions > New repository secret**에서 이름을 `FRED_API_KEY`로 하여 키를 저장합니다.

키가 등록되면 다음 실행부터 자동으로 API를 사용하며, 어느 방식을 썼는지는 `metadata.json`의 `retrieved_with`에 기록됩니다.

## 로컬 실행

```bash
pip install -r requirements.txt
export FRED_API_KEY=발급받은키   # 선택
python scripts/update_fx.py
```

## 시리즈 추가와 제외

`config/series.csv`에 행을 추가하거나 지우면 다음 실행부터 반영됩니다.

| 열 | 값 |
|---|---|
| `series_id` | FRED 시리즈 ID |
| `code` | `*_per_usd` 파일에 쓰는 열 이름 |
| `quote` | `per_usd`(미 달러 1단위당 외화) 또는 `usd_per`(외화 1단위당 미 달러) |
| `type` | `rate`(환율) 또는 `index`(지수, `*_per_usd` 파일에서 제외) |

## 출처

Board of Governors of the Federal Reserve System (US), *H.10 Foreign Exchange Rates*, retrieved from FRED, Federal Reserve Bank of St. Louis.

H.10 환율은 뉴욕 시간 정오 기준 전신환 매입률(noon buying rates)로, 뉴욕 연방준비은행이 관세 목적으로 인증한 값입니다. 한국은행 매매기준율과는 기준 시점과 산정 방식이 다릅니다.
