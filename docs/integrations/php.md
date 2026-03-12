# PHP

Generate PDFs from PHP (plain, Laravel, Slim) by running `typst-serverless` via `proc_open` or `shell_exec`.

## Lambda (AWS SDK)

If you've deployed the Lambda stack ([docs/lambda/](../lambda/README.md)):

```php
<?php
require 'vendor/autoload.php';
use Aws\Lambda\LambdaClient;

$client = new LambdaClient(['region' => 'us-east-1']);
$payload = [
    'action' => 'compile',
    'mainTyp' => base64_encode("#set page(width: 100pt)\nHello!"),
];
$result = $client->invoke([
    'FunctionName' => 'typst-compile-xxx',
    'Payload' => json_encode($payload),
]);
$data = json_decode((string) $result->get('Payload'));
// $data->pdf = base64 PDF, or $data->s3Url if storeToS3
```

## Plain PHP

```php
<?php
const TYPST_IMAGE = 'typst-serverless';

function generatePdf(): void
{
    $tmp = sys_get_temp_dir() . '/typst-' . uniqid();
    mkdir($tmp);

    try {
        file_put_contents("$tmp/main.typ", "#hello(world)\n");

        $cmd = sprintf(
            'docker run --rm -v %s:/workspace -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ -e TYPST_PIPE=true %s 2>/dev/null',
            escapeshellarg($tmp),
            escapeshellarg(TYPST_IMAGE)
        );
        $pdf = shell_exec($cmd);

        if (empty($pdf)) {
            http_response_code(500);
            header('Content-Type: application/json');
            echo json_encode(['error' => 'Compilation failed']);
            return;
        }

        header('Content-Type: application/pdf');
        header('Content-Disposition: attachment; filename="output.pdf"');
        echo $pdf;
    } finally {
        array_map('unlink', glob("$tmp/*"));
        rmdir($tmp);
    }
}

generatePdf();
```

## Laravel

Add a route and controller:

```php
// routes/web.php
Route::get('/pdf', [PdfController::class, 'show']);
```

```php
// app/Http/Controllers/PdfController.php
namespace App\Http\Controllers;

class PdfController extends Controller
{
    private const TYPST_IMAGE = 'typst-serverless';

    public function show()
    {
        $tmp = storage_path('app/temp/typst-' . uniqid());
        mkdir($tmp, 0755, true);

        try {
            file_put_contents("$tmp/main.typ", "#hello(world)\n");

            $cmd = sprintf(
                'docker run --rm -v %s:/workspace -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ -e TYPST_PIPE=true %s 2>/dev/null',
                escapeshellarg($tmp),
                escapeshellarg(self::TYPST_IMAGE)
            );
            $pdf = shell_exec($cmd);

            if (empty($pdf)) {
                return response()->json(['error' => 'Compilation failed'], 500);
            }

            return response($pdf)
                ->header('Content-Type', 'application/pdf')
                ->header('Content-Disposition', 'attachment; filename="output.pdf"');
        } finally {
            array_map('unlink', glob("$tmp/*"));
            rmdir($tmp);
        }
    }
}
```

## Slim

```php
<?php
use Slim\Factory\AppFactory;

$app = AppFactory::create();
const TYPST_IMAGE = 'typst-serverless';

$app->get('/pdf', function ($request, $response) {
    $tmp = sys_get_temp_dir() . '/typst-' . uniqid();
    mkdir($tmp);

    try {
        file_put_contents("$tmp/main.typ", "#hello(world)\n");

        $cmd = sprintf(
            'docker run --rm -v %s:/workspace -e TYPST_WORKSPACE=/workspace -e TYPST_MAIN=main.typ -e TYPST_PIPE=true %s 2>/dev/null',
            escapeshellarg($tmp),
            escapeshellarg(TYPST_IMAGE)
        );
        $pdf = shell_exec($cmd);

        if (empty($pdf)) {
            $response->getBody()->write(json_encode(['error' => 'Compilation failed']));
            return $response->withStatus(500)->withHeader('Content-Type', 'application/json');
        }

        $response->getBody()->write($pdf);
        return $response
            ->withHeader('Content-Type', 'application/pdf')
            ->withHeader('Content-Disposition', 'attachment; filename="output.pdf"');
    } finally {
        array_map('unlink', glob("$tmp/*"));
        rmdir($tmp);
    }
});

$app->run();
```
