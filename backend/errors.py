from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.responses import JSONResponse


class AppError(Exception):
    def __init__(
        self,
        status_code: int,
        code: str,
        message: str,
        fields: dict | None = None,
        headers: dict[str, str] | None = None,
    ):
        self.status_code = status_code
        self.code = code
        self.message = message
        self.fields = fields
        self.headers = headers

    def body(self) -> dict:
        payload = {"code": self.code, "message": self.message}
        if self.fields:
            payload["fields"] = self.fields
        return {"error": payload}


def not_found(message: str) -> AppError:
    return AppError(404, "not_found", message)


def validation_error(message: str, fields: dict | None = None) -> AppError:
    return AppError(422, "validation_error", message, fields)


def register_error_handlers(app: FastAPI) -> None:
    @app.exception_handler(AppError)
    async def handle_app_error(request: Request, exc: AppError):
        return JSONResponse(status_code=exc.status_code, content=exc.body(), headers=exc.headers)

    @app.exception_handler(RequestValidationError)
    async def handle_request_validation_error(request: Request, exc: RequestValidationError):
        fields: dict[str, str] = {}
        for err in exc.errors():
            loc = [str(part) for part in err["loc"] if part not in ("body", "query", "path")]
            key = ".".join(loc) if loc else "__root__"
            fields[key] = err["msg"]
        return JSONResponse(
            status_code=422,
            content={
                "error": {
                    "code": "validation_error",
                    "message": "Invalid request",
                    "fields": fields,
                }
            },
        )
