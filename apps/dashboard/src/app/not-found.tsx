import Link from 'next/link';
import { SgMark } from '@/components/sg-mark';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export default function NotFound() {
  return (
    <Card>
      <CardHeader>
        <div className="flex items-center gap-3">
          <SgMark size={36} />
          <p className="kicker">404</p>
        </div>
        <CardTitle className="text-2xl">Page not found</CardTitle>
        <CardDescription>
          That route does not exist, or this vault is not on the guard contract.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button asChild>
          <Link href="/">Back to vaults</Link>
        </Button>
      </CardContent>
    </Card>
  );
}
