"""
Sentry observability for Overflow's RLHF/GRPO training jobs.

Training runs are long and fail in ugly ways (OOM, NaN loss, KL blow-up). We
treat a run like a production service: exceptions are captured, each run is a
Sentry cron check-in (in_progress -> ok/error), and per-epoch metrics are sent
as breadcrumbs so a failure arrives with the loss/KL/reward trail attached.

Fully optional and defensive: if `sentry-sdk` isn't installed or SENTRY_DSN
isn't set, every function no-ops and training proceeds untouched.

Enable with:
    pip install sentry-sdk
    export SENTRY_DSN="https://<key>@<org>.ingest.<region>.sentry.io/<project>"
"""

from __future__ import annotations

import logging
import math
import os
from contextlib import contextmanager
from typing import Iterator, Optional

logger = logging.getLogger("overflow.sentry")

try:
    import sentry_sdk
    _HAS_SDK = True
except ImportError:
    sentry_sdk = None  # type: ignore
    _HAS_SDK = False

_enabled = False


def init_sentry(component: str) -> bool:
    """Initialize Sentry for a training component. Returns True if enabled."""
    global _enabled
    dsn = os.environ.get("SENTRY_DSN")
    if not _HAS_SDK:
        logger.info("[sentry] sentry-sdk not installed — training observability disabled.")
        return False
    if not dsn:
        logger.info("[sentry] SENTRY_DSN not set — training observability disabled.")
        return False

    sentry_sdk.init(
        dsn=dsn,
        traces_sample_rate=1.0,
        environment=os.environ.get("SENTRY_ENVIRONMENT", "training"),
        release=os.environ.get("SENTRY_RELEASE"),
    )
    sentry_sdk.set_tag("component", component)
    sentry_sdk.set_tag("pipeline", "overflow-rlhf")
    _enabled = True
    logger.info(f"[sentry] training observability enabled for '{component}'.")
    return True


def record_epoch(phase: str, epoch: int, metrics: dict) -> None:
    """Breadcrumb one training epoch and flag divergence (non-finite loss)."""
    if not _enabled:
        return
    data = {
        k: (float(v) if isinstance(v, (int, float)) else v)
        for k, v in metrics.items()
    }
    sentry_sdk.add_breadcrumb(
        category=f"train.{phase}", message=f"epoch {epoch}", level="info", data=data
    )
    loss = metrics.get("loss")
    if isinstance(loss, (int, float)) and (math.isnan(loss) or math.isinf(loss)):
        sentry_sdk.capture_message(
            f"[{phase}] non-finite loss at epoch {epoch}: {loss}", level="error"
        )


@contextmanager
def monitor_run(component: str, config: Optional[dict] = None) -> Iterator[None]:
    """
    Wrap a whole training run: report start/finish as a Sentry cron check-in and
    capture any exception (with the metric breadcrumb trail) before re-raising so
    the job still fails loudly in the terminal.
    """
    if not _enabled:
        yield
        return

    if config:
        sentry_sdk.set_context("training_config", config)

    monitor_slug = f"train-{component}"
    check_in_id = None
    try:
        check_in_id = sentry_sdk.crons.capture_checkin(
            monitor_slug=monitor_slug, status="in_progress"
        )
    except Exception:  # crons may be unavailable on some SDK versions/plans
        check_in_id = None

    try:
        with sentry_sdk.start_transaction(op="train", name=component):
            yield
    except Exception:
        if check_in_id is not None:
            try:
                sentry_sdk.crons.capture_checkin(
                    monitor_slug=monitor_slug, check_in_id=check_in_id, status="error"
                )
            except Exception:
                pass
        sentry_sdk.capture_exception()
        raise
    else:
        if check_in_id is not None:
            try:
                sentry_sdk.crons.capture_checkin(
                    monitor_slug=monitor_slug, check_in_id=check_in_id, status="ok"
                )
            except Exception:
                pass
    finally:
        try:
            sentry_sdk.flush(timeout=5)
        except Exception:
            pass
