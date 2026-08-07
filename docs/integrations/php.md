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

### Container mode

Add a route and controller:

```php
// routes/web.php
use App\Http\Controllers\PdfController;

Route::get('/pdf', [PdfController::class, 'generate']);
```

```php
// app/Http/Controllers/PdfController.php
namespace App\Http\Controllers;

use Illuminate\Http\Response;

class PdfController extends Controller
{
    private const TYPST_IMAGE = 'typst-serverless';

    public function generate()
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

### Lambda mode (AWS SDK)

Install AWS SDK:

```bash
composer require aws/aws-sdk-php
```

Add to `.env`:

```env
TYPST_LAMBDA_FUNCTION=typst-compile-xxx
AWS_DEFAULT_REGION=us-east-1
```

Create a service:

```php
// app/Services/TypstService.php
namespace App\Services;

use Aws\Lambda\LambdaClient;
use Illuminate\Support\Facades\Log;

class TypstService
{
    private LambdaClient $client;

    public function __construct()
    {
        $this->client = new LambdaClient([
            'region' => config('services.aws.region'),
            'version' => 'latest',
        ]);
    }

    public function compile(string $content, array $options = []): array
    {
        $payload = [
            'action' => 'compile',
            'mainTyp' => base64_encode($content),
            'storeToS3' => $options['storeToS3'] ?? false,
            'outputFormat' => $options['outputFormat'] ?? 'pdf',
        ];

        try {
            $result = $this->client->invoke([
                'FunctionName' => config('services.typst.lambda_function'),
                'Payload' => json_encode($payload),
            ]);

            return json_decode((string) $result->get('Payload'), true);
        } catch (\Exception $e) {
            Log::error('Typst compilation failed', ['error' => $e->getMessage()]);
            throw $e;
        }
    }
}
```

Add to `config/services.php`:

```php
'typst' => [
    'lambda_function' => env('TYPST_LAMBDA_FUNCTION'),
],
```

Controller:

```php
// app/Http/Controllers/PdfController.php
namespace App\Http\Controllers;

use App\Services\TypstService;
use Illuminate\Http\Request;

class PdfController extends Controller
{
    public function __construct(private TypstService $typst)
    {
    }

    public function generate(Request $request)
    {
        $content = $request->input('content', '#set page(width: 100pt)' . "\nHello from Laravel!");
        
        $result = $this->typst->compile($content, [
            'storeToS3' => $request->boolean('storeToS3'),
        ]);

        if (isset($result['s3Url'])) {
            return response()->json(['url' => $result['s3Url']]);
        }

        if (isset($result['pdf'])) {
            return response(base64_decode($result['pdf']))
                ->header('Content-Type', 'application/pdf')
                ->header('Content-Disposition', 'attachment; filename="output.pdf"');
        }

        return response()->json([
            'error' => $result['error'] ?? 'Unknown error'
        ], 500);
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
