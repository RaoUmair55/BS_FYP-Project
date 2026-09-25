#!/usr/bin/env python3
"""
IntegrityFlow Load Testing Script
Simulates concurrent students sending violations and optional teacher dashboard read queries.
Measures system latency, throughput, and error rates under real-world concurrency.
"""

import asyncio
import argparse
import random
import time
import sys
from datetime import datetime, timezone
from typing import List, Dict, Any, Optional

# Ensure UTF-8 output on Windows consoles
if hasattr(sys.stdout, 'reconfigure'):
    try:
        sys.stdout.reconfigure(encoding='utf-8', errors='replace')
    except Exception:
        pass

try:
    import httpx
except ImportError:
    print("Error: 'httpx' is required for running the load test. Install with: pip install httpx")
    sys.exit(1)

# Available violation templates matching CONTRACT.md
VIOLATION_TEMPLATES = [
    {
        "type": "head_turn_away",
        "severity": 2,
        "details": {"duration": 2.3, "reason": "Lateral head turn (angled view)"}
    },
    {
        "type": "second_person_detected",
        "severity": 4,
        "details": {"face_count": 2, "confidence": 0.89}
    },
    {
        "type": "no_face_detected",
        "severity": 3,
        "details": {"duration": 10.5, "reason": "Candidate missing from camera"}
    },
    {
        "type": "unauthorized_object",
        "severity": 3,
        "details": {"object_class": "cell phone", "confidence": 0.91}
    },
    {
        "type": "unauthorized_app",
        "severity": 3,
        "details": {"app_name": "Discord", "process_id": 14220}
    },
    {
        "type": "usb_device_detected",
        "severity": 4,
        "details": {"device_name": "SanDisk Cruzer Glide", "drive_letter": "E:"}
    },
    {
        "type": "multiple_displays_detected",
        "severity": 4,
        "details": {"display_count": 2, "primary": "1920x1080", "secondary": "2560x1440"}
    }
]

class RequestMetric:
    def __init__(self, req_type: str, status_code: int, duration_ms: float, success: bool, error: str = ""):
        self.req_type = req_type
        self.status_code = status_code
        self.duration_ms = duration_ms
        self.success = success
        self.error = error
        self.timestamp = datetime.now(timezone.utc).isoformat()

class LoadTestRunner:
    def __init__(
        self, 
        base_url: str, 
        student_count: int, 
        duration_seconds: int, 
        min_interval: float, 
        max_interval: float,
        with_reads: bool = False,
        exam_code: Optional[str] = None,
        teacher_email: str = "admin@integrityflow.com",
        teacher_password: str = "AdminSecurePass2026!"
    ):
        self.base_url = base_url.rstrip("/")
        self.student_count = student_count
        self.duration_seconds = duration_seconds
        self.min_interval = min_interval
        self.max_interval = max_interval
        self.with_reads = with_reads
        self.exam_code = exam_code
        self.teacher_email = teacher_email
        self.teacher_password = teacher_password
        
        self.sessions: List[Dict[str, Any]] = []
        self.metrics: List[RequestMetric] = []
        self.auth_token: Optional[str] = None
        self.start_time: float = 0.0
        self.end_time: float = 0.0

    async def authenticate_teacher(self, client: httpx.AsyncClient) -> bool:
        """Logs in as teacher to obtain JWT token for protected read endpoints and exam creation."""
        url = f"{self.base_url}/auth/login"
        payload = {
            "email": self.teacher_email,
            "password": self.teacher_password
        }
        try:
            res = await client.post(url, json=payload, timeout=5.0)
            if res.status_code == 200:
                data = res.json()
                self.auth_token = data.get("accessToken")
                print(f"[Auth] Teacher authenticated successfully (Token acquired).")
                return True
            else:
                print(f"[Auth Warning] Teacher login returned status {res.status_code}: {res.text}")
                return False
        except Exception as e:
            print(f"[Auth Warning] Failed to connect for teacher auth: {e}")
            return False

    async def ensure_active_exam(self, client: httpx.AsyncClient) -> Optional[str]:
        """Ensures an open, active exam code exists for candidate session creation."""
        if self.exam_code:
            return self.exam_code

        # If we have teacher auth, create a dedicated load test exam
        if self.auth_token:
            url = f"{self.base_url}/exams"
            headers = {"Authorization": f"Bearer {self.auth_token}"}
            payload = {
                "title": f"Load Test Run {int(time.time())}",
                "durationMinutes": int(max(60, (self.duration_seconds / 60) + 30)),
                "status": "active"
            }
            try:
                res = await client.post(url, headers=headers, data=payload, timeout=6.0)
                if res.status_code == 201:
                    exam_obj = res.json().get("exam", {})
                    code = exam_obj.get("examCode") or exam_obj.get("examId")
                    print(f"[Exam Setup] Created dedicated active test exam: {code}")
                    self.exam_code = code
                    return code
            except Exception as e:
                print(f"[Exam Setup Warning] Could not create new exam: {e}")

        # Fallback to default code
        return "EXAM-LOADTEST"

    async def create_student_session(self, client: httpx.AsyncClient, index: int) -> Optional[Dict[str, Any]]:
        """Creates a simulated student session via POST /sessions."""
        student_name = f"Test Student {index + 1}"
        roll_number = f"TEST-{index + 1:03d}"
        payload = {
            "studentName": student_name,
            "rollNumber": roll_number,
            "studentId": f"stu-test-{index + 1}",
            "examId": self.exam_code or "EXAM-LOADTEST",
            "consentGiven": True,
            "consentTimestamp": datetime.now(timezone.utc).isoformat()
        }
        url = f"{self.base_url}/sessions"
        start = time.perf_counter()
        try:
            res = await client.post(url, json=payload, timeout=8.0)
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            if res.status_code == 201:
                sess_data = res.json()
                session_id = sess_data.get("_id") or sess_data.get("id") or sess_data.get("sessionId")
                self.metrics.append(RequestMetric("CREATE_SESSION", res.status_code, elapsed_ms, True))
                return {
                    "sessionId": str(session_id),
                    "studentName": student_name,
                    "rollNumber": roll_number
                }
            else:
                self.metrics.append(RequestMetric("CREATE_SESSION", res.status_code, elapsed_ms, False, res.text))
                return None
        except Exception as e:
            elapsed_ms = (time.perf_counter() - start) * 1000.0
            self.metrics.append(RequestMetric("CREATE_SESSION", 0, elapsed_ms, False, str(e)))
            return None

    async def student_violation_worker(self, client: httpx.AsyncClient, session: Dict[str, Any], stop_event: asyncio.Event):
        """Simulates one student continuously generating violations at random intervals."""
        session_id = session["sessionId"]
        student_name = session["studentName"]
        url = f"{self.base_url}/violation"

        # Stagger initial start to avoid artificial synchronized stampede
        initial_jitter = random.uniform(0.5, 4.0)
        await asyncio.sleep(initial_jitter)

        while not stop_event.is_set():
            try:
                template = random.choice(VIOLATION_TEMPLATES)
                payload = {
                    "sessionId": session_id,
                    "type": template["type"],
                    "severity": template["severity"],
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "details": template["details"]
                }

                start = time.perf_counter()
                try:
                    res = await client.post(url, json=payload, timeout=8.0)
                    elapsed_ms = (time.perf_counter() - start) * 1000.0
                    is_success = (res.status_code in (200, 201))
                    
                    resp_body_snippet = ""
                    if not is_success:
                        try:
                            resp_body_snippet = res.text.strip().replace('\n', ' ')[:250]
                        except Exception:
                            resp_body_snippet = "<unreadable response body>"
                    
                    err_msg = "" if is_success else f"HTTP {res.status_code}: {resp_body_snippet}"
                    self.metrics.append(RequestMetric("POST_VIOLATION", res.status_code, elapsed_ms, is_success, err_msg))
                    
                    # Real-time console log
                    status_icon = "[OK]" if is_success else "[FAIL]"
                    now_str = datetime.now().strftime("%H:%M:%S")
                    if is_success:
                        print(f"[{now_str}] {status_icon} [POST /violation] {student_name} -> {template['type']} ({elapsed_ms:.1f}ms) [{res.status_code}]", flush=True)
                    else:
                        print(f"[{now_str}] {status_icon} [POST /violation FAILED] {student_name} -> {template['type']} ({elapsed_ms:.1f}ms) [{res.status_code}]: {resp_body_snippet}", flush=True)
                except Exception as req_err:
                    elapsed_ms = (time.perf_counter() - start) * 1000.0
                    err_str = f"Network/Timeout Exception: {str(req_err)}"
                    self.metrics.append(RequestMetric("POST_VIOLATION", 0, elapsed_ms, False, err_str))
                    now_str = datetime.now().strftime("%H:%M:%S")
                    print(f"[{now_str}] [FAIL] [POST /violation EXCEPTION] {student_name} -> {err_str} ({elapsed_ms:.1f}ms)", flush=True)
            except Exception as loop_err:
                print(f"[Worker Error] Unexpected error in worker loop for {student_name}: {loop_err}", flush=True)

            # Random interval before next violation
            interval = random.uniform(self.min_interval, self.max_interval)
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=interval)
            except asyncio.TimeoutError:
                pass

    async def dashboard_reader_worker(self, client: httpx.AsyncClient, stop_event: asyncio.Event):
        """Simulates an instructor dashboard polling student violation lists and risk scores."""
        headers = {}
        if self.auth_token:
            headers["Authorization"] = f"Bearer {self.auth_token}"

        while not stop_event.is_set():
            try:
                if not self.sessions:
                    await asyncio.sleep(1.0)
                    continue

                target_session = random.choice(self.sessions)
                session_id = target_session["sessionId"]

                # 1. Read /violations/:sessionId
                v_url = f"{self.base_url}/violations/{session_id}"
                start_v = time.perf_counter()
                try:
                    res = await client.get(v_url, headers=headers, timeout=6.0)
                    elapsed_v = (time.perf_counter() - start_v) * 1000.0
                    is_success = (res.status_code == 200)
                    err_msg = "" if is_success else f"HTTP {res.status_code}: {res.text[:150]}"
                    self.metrics.append(RequestMetric("GET_VIOLATIONS", res.status_code, elapsed_v, is_success, err_msg))
                    if not is_success:
                        print(f"[Dashboard Read FAILED] GET /violations/{session_id} -> HTTP {res.status_code}: {err_msg}", flush=True)
                except Exception as e:
                    elapsed_v = (time.perf_counter() - start_v) * 1000.0
                    err_str = f"Network/Timeout Exception: {str(e)}"
                    self.metrics.append(RequestMetric("GET_VIOLATIONS", 0, elapsed_v, False, err_str))

                # 2. Read /risk-score/:sessionId
                r_url = f"{self.base_url}/risk-score/{session_id}"
                start_r = time.perf_counter()
                try:
                    res = await client.get(r_url, headers=headers, timeout=6.0)
                    elapsed_r = (time.perf_counter() - start_r) * 1000.0
                    is_success = (res.status_code == 200)
                    err_msg = "" if is_success else f"HTTP {res.status_code}: {res.text[:150]}"
                    self.metrics.append(RequestMetric("GET_RISK_SCORE", res.status_code, elapsed_r, is_success, err_msg))
                    if not is_success:
                        print(f"[Dashboard Read FAILED] GET /risk-score/{session_id} -> HTTP {res.status_code}: {err_msg}", flush=True)
                except Exception as e:
                    elapsed_r = (time.perf_counter() - start_r) * 1000.0
                    err_str = f"Network/Timeout Exception: {str(e)}"
                    self.metrics.append(RequestMetric("GET_RISK_SCORE", 0, elapsed_r, False, err_str))
            except Exception as reader_loop_err:
                print(f"[Reader Error] Unexpected error in dashboard reader loop: {reader_loop_err}", flush=True)

            # Poll every 2.0 to 3.5 seconds
            try:
                await asyncio.wait_for(stop_event.wait(), timeout=random.uniform(2.0, 3.5))
            except asyncio.TimeoutError:
                pass

    async def run(self):
        print("\n" + "="*70)
        print("  INTEGRITYFLOW HIGH-CONCURRENCY LOAD TEST")
        print("="*70)
        print(f"Target Server:        {self.base_url}")
        print(f"Concurrent Students:  {self.student_count}")
        print(f"Test Duration:        {self.duration_seconds} seconds ({self.duration_seconds/60:.1f} min)")
        print(f"Violation Interval:   {self.min_interval}s - {self.max_interval}s per student (Randomized)")
        print(f"Dashboard Polling:    {'Enabled' if self.with_reads else 'Disabled'}")
        print("="*70 + "\n", flush=True)

        limits = httpx.Limits(max_keepalive_connections=80, max_connections=120)
        async with httpx.AsyncClient(limits=limits) as client:
            # 1. Health check
            try:
                health_res = await client.get(f"{self.base_url}/health", timeout=3.0)
                print(f"[Health Check] Server is reachable. Status: {health_res.status_code}", flush=True)
            except Exception as e:
                print(f"[Health Check Error] Cannot connect to {self.base_url}/health: {e}", flush=True)
                print("Please ensure your backend server is running (npm run dev in server directory).", flush=True)
                return

            # 2. Authenticate teacher and ensure open exam code exists
            await self.authenticate_teacher(client)
            await self.ensure_active_exam(client)

            # 3. Create concurrent candidate sessions
            print(f"\n[Phase 1] Initializing {self.student_count} student sessions for exam '{self.exam_code}'...", flush=True)
            creation_tasks = [self.create_student_session(client, i) for i in range(self.student_count)]
            created_results = await asyncio.gather(*creation_tasks)
            self.sessions = [s for s in created_results if s is not None]

            print(f"[Phase 1 Complete] Successfully created {len(self.sessions)}/{self.student_count} sessions.\n", flush=True)
            if not self.sessions:
                print("No sessions were created. Aborting load test.", flush=True)
                return

            # 4. Spawn concurrent violation workers
            print(f"[Phase 2] Spawning {len(self.sessions)} concurrent student violation workers...", flush=True)
            stop_event = asyncio.Event()
            self.start_time = time.time()

            tasks = []
            for s in self.sessions:
                tasks.append(asyncio.create_task(self.student_violation_worker(client, s, stop_event)))

            # Spawn dashboard readers if enabled
            if self.with_reads:
                print("[Phase 2] Spawning 2 simulated teacher dashboard readers...", flush=True)
                tasks.append(asyncio.create_task(self.dashboard_reader_worker(client, stop_event)))
                tasks.append(asyncio.create_task(self.dashboard_reader_worker(client, stop_event)))

            print(f"[Phase 2 Running] Generating load for {self.duration_seconds} seconds. Press Ctrl+C to stop early.\n", flush=True)

            try:
                await asyncio.sleep(self.duration_seconds)
            except asyncio.CancelledError:
                pass
            finally:
                stop_event.set()
                self.end_time = time.time()
                await asyncio.gather(*tasks, return_exceptions=True)

        self.print_summary()

    def print_summary(self):
        """Calculates and prints comprehensive summary metrics."""
        total_time = max(0.1, self.end_time - self.start_time)
        
        all_metrics = self.metrics
        violation_metrics = [m for m in all_metrics if m.req_type == "POST_VIOLATION"]
        read_metrics = [m for m in all_metrics if m.req_type in ("GET_VIOLATIONS", "GET_RISK_SCORE")]
        session_metrics = [m for m in all_metrics if m.req_type == "CREATE_SESSION"]

        def calc_stats(metric_list: List[RequestMetric]):
            if not metric_list:
                return {
                    "total": 0, "success": 0, "failed": 0, "error_rate": 0.0,
                    "avg_ms": 0.0, "min_ms": 0.0, "max_ms": 0.0,
                    "p50_ms": 0.0, "p90_ms": 0.0, "p95_ms": 0.0, "p99_ms": 0.0,
                    "rps": 0.0
                }
            
            durations = sorted([m.duration_ms for m in metric_list])
            total = len(metric_list)
            success = sum(1 for m in metric_list if m.success)
            failed = total - success
            
            p50 = durations[int(len(durations) * 0.50)]
            p90 = durations[min(int(len(durations) * 0.90), len(durations) - 1)]
            p95 = durations[min(int(len(durations) * 0.95), len(durations) - 1)]
            p99 = durations[min(int(len(durations) * 0.99), len(durations) - 1)]
            
            return {
                "total": total,
                "success": success,
                "failed": failed,
                "error_rate": (failed / total) * 100.0,
                "avg_ms": sum(durations) / total,
                "min_ms": durations[0],
                "max_ms": durations[-1],
                "p50_ms": p50,
                "p90_ms": p90,
                "p95_ms": p95,
                "p99_ms": p99,
                "rps": total / total_time
            }

        v_stats = calc_stats(violation_metrics)
        r_stats = calc_stats(read_metrics)
        all_stats = calc_stats(all_metrics)

        print("\n" + "="*75)
        print("         === LOAD TEST REPORT (BEFORE OPTIMIZATION) ===")
        print("="*75)
        print(f"Total Test Wall-Clock Time:  {total_time:.2f} seconds ({total_time/60:.2f} min)")
        print(f"Simulated Student Sessions:   {len(self.sessions)} concurrent candidates")
        print(f"Total HTTP Requests Sent:    {all_stats['total']} requests")
        print(f"Overall Effective Throughput: {all_stats['rps']:.2f} req/sec")
        print(f"Overall Success Rate:        {all_stats['success']}/{all_stats['total']} ({100 - all_stats['error_rate']:.1f}%)")
        print(f"Overall Failures/Timeouts:   {all_stats['failed']} ({all_stats['error_rate']:.1f}%)")
        print("-" * 75)

        print(f"{'METRIC':<30} | {'VIOLATION WRITES':<18} | {'DASHBOARD READS':<18}")
        print("-" * 75)
        print(f"{'Total Requests':<30} | {v_stats['total']:<18} | {r_stats['total']:<18}")
        print(f"{'Success Count':<30} | {v_stats['success']:<18} | {r_stats['success']:<18}")
        print(f"{'Failure / Timeout Count':<30} | {v_stats['failed']:<18} | {r_stats['failed']:<18}")
        print(f"{'Error Rate':<30} | {v_stats['error_rate']:.2f}%{'':<13} | {r_stats['error_rate']:.2f}%{'':<13}")
        print(f"{'Average Latency':<30} | {v_stats['avg_ms']:.2f} ms{'':<11} | {r_stats['avg_ms']:.2f} ms{'':<11}")
        print(f"{'Min Latency':<30} | {v_stats['min_ms']:.2f} ms{'':<11} | {r_stats['min_ms']:.2f} ms{'':<11}")
        print(f"{'Median (P50) Latency':<30} | {v_stats['p50_ms']:.2f} ms{'':<11} | {r_stats['p50_ms']:.2f} ms{'':<11}")
        print(f"{'90th Percentile (P90)':<30} | {v_stats['p90_ms']:.2f} ms{'':<11} | {r_stats['p90_ms']:.2f} ms{'':<11}")
        print(f"{'95th Percentile (P95)':<30} | {v_stats['p95_ms']:.2f} ms{'':<11} | {r_stats['p95_ms']:.2f} ms{'':<11}")
        print(f"{'99th Percentile (P99)':<30} | {v_stats['p99_ms']:.2f} ms{'':<11} | {r_stats['p99_ms']:.2f} ms{'':<11}")
        print(f"{'Max Peak Latency':<30} | {v_stats['max_ms']:.2f} ms{'':<11} | {r_stats['max_ms']:.2f} ms{'':<11}")
        print(f"{'Throughput (RPS)':<30} | {v_stats['rps']:.2f} req/s{'':<10} | {r_stats['rps']:.2f} req/s{'':<10}")
        print("-" * 75)

        # Failure Breakdown Grouping
        failed_metrics = [m for m in all_metrics if not m.success]
        if failed_metrics:
            from collections import Counter
            print("FAILURE BREAKDOWN (Grouped by Request Type, HTTP Code & Error):")
            print("-" * 75)
            failure_counts = Counter()
            for m in failed_metrics:
                key = f"[{m.req_type}] HTTP {m.status_code} -> {m.error or 'Unknown Error'}"
                failure_counts[key] += 1

            for reason, count in failure_counts.most_common():
                pct = (count / len(failed_metrics)) * 100.0
                print(f"  * {count:3d}x ({pct:5.1f}%): {reason}")
        else:
            print("FAILURE BREAKDOWN: No request failures recorded (100% Success).")
        print("="*75 + "\n", flush=True)

def main():
    parser = argparse.ArgumentParser(description="IntegrityFlow High-Concurrency Load Tester")
    parser.add_argument("--url", default="http://localhost:5000", help="Base URL of backend server (default: http://localhost:5000)")
    parser.add_argument("--students", type=int, default=40, help="Number of concurrent student sessions (default: 40)")
    parser.add_argument("--duration", type=int, default=180, help="Duration of load test in seconds (default: 180s = 3m)")
    parser.add_argument("--min-interval", type=float, default=5.0, help="Minimum seconds between violations per student (default: 5.0)")
    parser.add_argument("--max-interval", type=float, default=15.0, help="Maximum seconds between violations per student (default: 15.0)")
    parser.add_argument("--with-reads", action="store_true", help="Simulate concurrent teacher dashboard reads (/violations and /risk-score)")
    parser.add_argument("--teacher-email", default="admin@integrityflow.com", help="Teacher email for auth")
    parser.add_argument("--teacher-password", default="AdminSecurePass2026!", help="Teacher password for auth")

    args = parser.parse_args()

    runner = LoadTestRunner(
        base_url=args.url,
        student_count=args.students,
        duration_seconds=args.duration,
        min_interval=args.min_interval,
        max_interval=args.max_interval,
        with_reads=args.with_reads,
        teacher_email=args.teacher_email,
        teacher_password=args.teacher_password
    )

    try:
        asyncio.run(runner.run())
    except KeyboardInterrupt:
        print("\n[Load Test] Interrupted by user. Generating partial summary...")
        runner.end_time = time.time()
        runner.print_summary()

if __name__ == "__main__":
    main()
