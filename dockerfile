FROM python:3.11-slim
WORKDIR /app
COPY requirements.txt .
RUN pip install -r requirements.txt --no-cache-dir
COPY cobra-service.py .
EXPOSE 5000
CMD ["python", "cobra-service.py"]