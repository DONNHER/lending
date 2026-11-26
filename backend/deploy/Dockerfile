FROM php:8.5-apache AS api
RUN apt-get update \
    && apt-get install -y --no-install-recommends libpq-dev libzip-dev libonig-dev postgresql-client unzip \
    && docker-php-ext-install pdo_pgsql zip mbstring \
    && a2enmod rewrite \
    && rm -rf /var/lib/apt/lists/*
COPY --from=composer:2 /usr/bin/composer /usr/local/bin/composer
WORKDIR /srv/argivet
COPY backend/composer.json backend/composer.lock ./
COPY backend/artisan ./
COPY backend/app app
COPY backend/bootstrap bootstrap
COPY backend/config config
COPY backend/database database
COPY backend/public public
COPY backend/routes routes
RUN mkdir -p storage/framework/cache/data storage/framework/sessions storage/framework/views storage/logs storage/app/private bootstrap/cache \
    && composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader \
    && chown -R www-data:www-data storage bootstrap/cache \
    && sed -i 's@DocumentRoot /var/www/html@DocumentRoot /srv/argivet/public@' /etc/apache2/sites-available/000-default.conf \
    && printf '%s\n' '<Directory /srv/argivet/public>' 'Require all granted' 'FallbackResource /index.php' 'Options -Indexes' '</Directory>' > /etc/apache2/conf-enabled/argivet.conf \
    && printf '%s\n' 'upload_max_filesize=12M' 'post_max_size=15M' 'expose_php=Off' > /usr/local/etc/php/conf.d/argivet.ini
ARG APP_VERSION=dev
ENV APP_VERSION=$APP_VERSION

FROM node:24-bookworm-slim AS frontend
WORKDIR /build
ENV ELECTRON_SKIP_BINARY_DOWNLOAD=1
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/index.html frontend/tsconfig.json frontend/vite.config.ts ./
COPY frontend/src src
COPY frontend/public public
ENV VITE_ARGIVET_ENTRY=loan
RUN npm run build

FROM nginx:alpine AS loan
COPY backend/deploy/loan.conf /etc/nginx/conf.d/default.conf
COPY --from=frontend /build/dist /usr/share/nginx/html
