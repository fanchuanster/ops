"""
Django settings for the NobleSee web service.

Everything environment-specific is read from the environment, with
development-safe defaults, matching the convention the WordPress stack
already uses in `.env`. Nothing secret is ever committed here: a missing
NOBLESEE_SECRET_KEY is fatal when DEBUG is off, and harmless in dev.
"""

import os
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent


def env_bool(name: str, default: bool) -> bool:
    raw = os.environ.get(name)
    if raw is None:
        return default
    return raw.strip().lower() in {"1", "true", "yes", "on"}


def env_list(name: str, default: str) -> list[str]:
    return [item.strip() for item in os.environ.get(name, default).split(",") if item.strip()]


DEBUG = env_bool("NOBLESEE_DEBUG", True)

# Dev default is a fixed throwaway value so `docker compose up` works
# with no configuration. Refusing to boot without a real key in
# production is deliberate — a silently-generated key would invalidate
# every session on restart.
SECRET_KEY = os.environ.get("NOBLESEE_SECRET_KEY", "")
if not SECRET_KEY:
    if DEBUG:
        SECRET_KEY = "dev-only-insecure-key-do-not-use-in-production"
    else:
        raise RuntimeError("NOBLESEE_SECRET_KEY must be set when NOBLESEE_DEBUG is off")

ALLOWED_HOSTS = env_list("NOBLESEE_ALLOWED_HOSTS", "localhost,127.0.0.1,web,[::1]")
CSRF_TRUSTED_ORIGINS = env_list("NOBLESEE_CSRF_TRUSTED_ORIGINS", "")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "noblesee.urls"
WSGI_APPLICATION = "noblesee.wsgi.application"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
            ],
        },
    },
]

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.postgresql",
        "NAME": os.environ.get("POSTGRES_DB", "noblesee"),
        "USER": os.environ.get("POSTGRES_USER", "noblesee"),
        "PASSWORD": os.environ.get("POSTGRES_PASSWORD", "noblesee"),
        "HOST": os.environ.get("POSTGRES_HOST", "webdb"),
        "PORT": os.environ.get("POSTGRES_PORT", "5432"),
        # Reuse connections between requests; the converter service will
        # push bursty traffic through here later.
        "CONN_MAX_AGE": int(os.environ.get("POSTGRES_CONN_MAX_AGE", "60")),
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = os.environ.get("NOBLESEE_TIME_ZONE", "UTC")
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
STATIC_ROOT = BASE_DIR / "staticfiles"

DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

# Behind the Cloudflare Tunnel the origin hop is plain HTTP, exactly as
# it was for WordPress — trust the forwarded proto so request.is_secure()
# stays true and redirects don't downgrade.
SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")

if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
    SECURE_HSTS_SECONDS = int(os.environ.get("NOBLESEE_HSTS_SECONDS", "31536000"))
    SECURE_HSTS_INCLUDE_SUBDOMAINS = True

LOGGING = {
    "version": 1,
    "disable_existing_loggers": False,
    "formatters": {
        "structured": {
            "format": "%(asctime)s %(levelname)s %(name)s %(message)s",
        },
    },
    "handlers": {
        "console": {
            "class": "logging.StreamHandler",
            "formatter": "structured",
        },
    },
    "root": {
        "handlers": ["console"],
        "level": os.environ.get("NOBLESEE_LOG_LEVEL", "INFO"),
    },
}
